// POST /api/ml/segment — lettuce instance segmentation (YOLOv8s-seg).
//
// Deliberately a SEPARATE route from /api/ml/predict rather than a branch
// inside it. That route is contamination-specific end to end: it queries
// `name: { startsWith: "contamination" }`, early-returns fallback when no
// contamination model exists, averages softmax over a fold ensemble, and its
// preprocessImage() is fixed at 224x224 with ImageNet mean/std. Adding a second
// task inside it would mean editing a working path days before a harvest.
//
// The two routes share exactly one thing — getOrLoadSession() in
// src/lib/onnx-session.ts, extracted verbatim so both use one Blob-fetch +
// WASM-init + session-cache implementation.
//
// The preprocessing here is NEW and must stay that way: YOLOv8 expects plain
// /255 with NO mean/std subtraction. Running these frames through the
// contamination route's preprocessImage() produces confident garbage and raises
// no error anywhere.
//
// Returns POLYGONS in original-image coordinates, not raster masks: the Pi
// rasterises them against depth it already holds locally, so it never has to
// upload the ~1.3 MB depth frame.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";
import { getOrLoadSession } from "@/lib/onnx-session";
import {
  anchorsForInputSize,
  buildProtoMask,
  computeLetterbox,
  containmentDedup,
  decodeCandidates,
  largestComponent,
  nms,
  rasteriseToOriginal,
  simplifyPolygon,
  traceContour,
  type Candidate,
  type LetterboxGeometry,
} from "@/lib/yolo-seg";

// ─── Tunables ───
//
// CONF/IOU match the values the lab evaluation used (ultralytics conf=0.25,
// iou=0.6 — test-supervisor/lab/NOTEBOOK.md iterations 74-75), so this route
// reproduces those instance counts. Both are overridable per request purely so
// a comparison run can be reproduced; the defaults are what production uses.
const DEFAULT_CONF_THRESHOLD = 0.25;
const DEFAULT_NMS_IOU = 0.6;

// A mask that shares more than this fraction of the SMALLER of two masks is
// treated as the same object. Set high because the case being caught is a
// whole-canopy blob that nearly totally contains a plant, not partial overlap
// between neighbouring plants (which is real and must survive).
const CONTAINMENT_THRESHOLD = 0.8;

// Douglas-Peucker tolerance, in original-image pixels. ~1 px keeps the polygon
// visually identical to the mask while cutting the payload by ~20x.
const POLYGON_TOLERANCE_PX = 1.0;

// Letterbox fill. Must be 114 — it is what ultralytics pads with, so it is what
// the model saw in training.
const PAD_VALUE = 114;

const FALLBACK_INPUT_SIZE = 896;
const SUPPORTED_INPUT_SIZES = [896, 640];

// ─── Preprocessing (NEW — do not route this through preprocessImage()) ───

type Preprocessed = {
  data: Float32Array;
  geometry: LetterboxGeometry;
};

/**
 * Resize preserving aspect ratio into an inputSize x inputSize letterbox padded
 * with grey (114), scale to /255, convert HWC -> NCHW.
 *
 * No mean/std subtraction, by design — see the file header.
 */
async function preprocessForYolo(
  base64Image: string,
  inputSize: number
): Promise<Preprocessed> {
  const sharpModule = (await import("sharp")).default;
  const imageBuffer = Buffer.from(base64Image, "base64");

  const meta = await sharpModule(imageBuffer).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Could not read image dimensions");
  }

  const geometry = computeLetterbox(meta.width, meta.height, inputSize);
  const { resizedWidth, resizedHeight, padLeft, padTop } = geometry;

  // Explicit resize + extend rather than fit:"contain", so the pad offsets used
  // to map coordinates back are exactly the ones sharp applied.
  const { data } = await sharpModule(imageBuffer)
    .resize(resizedWidth, resizedHeight, { fit: "fill" })
    .extend({
      top: padTop,
      bottom: inputSize - resizedHeight - padTop,
      left: padLeft,
      right: inputSize - resizedWidth - padLeft,
      background: { r: PAD_VALUE, g: PAD_VALUE, b: PAD_VALUE },
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = inputSize * inputSize;
  const float32 = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    float32[i] = data[i * 3] / 255;
    float32[pixels + i] = data[i * 3 + 1] / 255;
    float32[2 * pixels + i] = data[i * 3 + 2] / 255;
  }

  return { data: float32, geometry };
}

// ─── Output selection ───

type TensorLike = { data: Float32Array; dims: readonly number[] };

/**
 * Pick the detection tensor ([1, 4+nc+ncoeff, anchors]) and the prototype
 * tensor ([1, 32, mh, mw]) BY SHAPE rather than by index or name.
 *
 * The prototypes must be the genuine [1, 32, mh, mw] output — selecting a
 * different 32-channel output yields rectangular masks that look plausible and
 * are wrong, so this fails loudly instead of guessing.
 */
function selectOutputs(results: Record<string, TensorLike>): {
  det: TensorLike;
  protos: TensorLike;
} {
  const tensors = Object.values(results);
  const det = tensors.find((t) => t.dims.length === 3);
  const protos = tensors.find((t) => t.dims.length === 4);

  if (!det) {
    throw new Error(
      `No 3-D detection output found; got shapes ${tensors.map((t) => `[${t.dims}]`).join(" ")}`
    );
  }
  if (!protos) {
    throw new Error(
      `No 4-D prototype output found; got shapes ${tensors.map((t) => `[${t.dims}]`).join(" ")}`
    );
  }
  if (protos.dims[1] !== det.dims[1] - 5) {
    throw new Error(
      `Prototype channels (${protos.dims[1]}) do not match the mask coefficients in the detection output (${det.dims[1] - 5})`
    );
  }
  return { det, protos };
}

/** Static input edge from the model's own metadata, so a 640 or 896 export
 *  works without a code change. Falls back to 896 when the graph is dynamic. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveInputSize(session: any): number {
  try {
    const meta = session.inputMetadata?.[0];
    const shape = meta?.shape ?? meta?.dimensions;
    if (Array.isArray(shape) && shape.length === 4) {
      const h = shape[2];
      const w = shape[3];
      if (typeof h === "number" && h > 0 && h === w) return h;
    }
  } catch {
    // metadata shape is advisory; the anchor-count check below is authoritative
  }
  return FALLBACK_INPUT_SIZE;
}

// ─── Route handler ───

export async function POST(request: NextRequest) {
  const { error } = await validateApiKey(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { cropType, image } = body ?? {};

    if (!cropType || !image) {
      return NextResponse.json(
        { error: "cropType and image are required" },
        { status: 400 }
      );
    }

    const confThreshold =
      typeof body.conf === "number" ? body.conf : DEFAULT_CONF_THRESHOLD;
    const iouThreshold =
      typeof body.iou === "number" ? body.iou : DEFAULT_NMS_IOU;

    // Same convention as the contamination route: "oyster_blue" -> "oyster".
    const modelFamily = String(cropType).split("_")[0];

    // Fail closed. A basil frame must get the fallback, never a lettuce model —
    // the model has only ever seen lettuce, one camera height, one LED
    // spectrum, days 1-16.
    const model = await prisma.mLModel.findFirst({
      where: {
        name: { startsWith: "segmentation" },
        cropType: modelFamily,
        isActive: true,
      },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    });

    if (!model) {
      return NextResponse.json(
        {
          fallback: true,
          reason: `No active segmentation model for cropType "${modelFamily}"`,
          segmentation: null,
          models_used: {},
          inference_ms: 0,
        },
        { status: 200 }
      );
    }

    const startTime = Date.now();

    const session = await getOrLoadSession(
      `${model.name}_${model.cropType}_${model.version}`,
      model.fileUrl
    );

    const inputSize = resolveInputSize(session);
    const { data: inputData, geometry } = await preprocessForYolo(
      image,
      inputSize
    );

    const ort = await import("onnxruntime-web");
    const inputTensor = new ort.Tensor("float32", inputData, [
      1,
      3,
      inputSize,
      inputSize,
    ]);

    const results = await session.run({ [session.inputNames[0]]: inputTensor });
    const { det, protos } = selectOutputs(results as Record<string, TensorLike>);

    const channels = det.dims[1];
    const numAnchors = det.dims[2];
    const numCoeffs = protos.dims[1];
    const [, , mh, mw] = protos.dims;

    // The anchor count is a function of the input edge. If it disagrees with
    // the size we preprocessed at, every box coordinate below would be silently
    // mis-scaled, so refuse rather than return plausible nonsense.
    const expectedAnchors = anchorsForInputSize(inputSize);
    if (numAnchors !== expectedAnchors) {
      const actual = SUPPORTED_INPUT_SIZES.find(
        (s) => anchorsForInputSize(s) === numAnchors
      );
      throw new Error(
        `Model emitted ${numAnchors} anchors, but input size ${inputSize} implies ${expectedAnchors}` +
          (actual ? ` — this looks like a ${actual} px export` : "")
      );
    }

    // 1. Raw candidates (output0 transposed on the fly), 2. box NMS.
    const candidates = decodeCandidates(
      det.data,
      channels,
      numAnchors,
      confThreshold
    );
    const afterNms = nms(candidates, iouThreshold);

    // 3. Prototype masks at proto resolution, then the mask-level containment
    //    dedup box NMS cannot do (a nested mask has low box IoU).
    const withMasks = afterNms.map((cand: Candidate) => ({
      cand,
      mask: buildProtoMask(cand, protos.data, numCoeffs, mh, mw, inputSize),
    }));
    const deduped = containmentDedup(withMasks, CONTAINMENT_THRESHOLD);

    // 4. Upsample, crop to each instance's own box, threshold, and trace a
    //    polygon — all directly in original-image coordinates, so the letterbox
    //    pad and scale are undone exactly once.
    const instances: Array<{
      polygon: Array<[number, number]>;
      confidence: number;
      area_px: number;
    }> = [];

    for (const { cand, mask } of deduped) {
      const sub = rasteriseToOriginal(cand, mask, mh, mw, geometry);
      if (sub.width === 0 || sub.height === 0) continue;

      const { data: component, area } = largestComponent(sub);
      if (area === 0) continue;

      const contour = traceContour(component, sub.width, sub.height);
      if (contour.length < 3) continue;

      const simplified = simplifyPolygon(contour, POLYGON_TOLERANCE_PX);
      if (simplified.length < 3) continue;

      instances.push({
        polygon: simplified.map(
          ([x, y]) =>
            [
              Math.round((sub.offsetX + x) * 10) / 10,
              Math.round((sub.offsetY + y) * 10) / 10,
            ] as [number, number]
        ),
        confidence: Math.round(cand.confidence * 10000) / 10000,
        area_px: area,
      });
    }

    instances.sort((a, b) => b.area_px - a.area_px);

    const inferenceMs = Date.now() - startTime;

    return NextResponse.json(
      {
        segmentation: {
          instances,
          model: `${model.name}@v${model.version}`,
          inference_ms: inferenceMs,
        },
        fallback: false,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[ML] Segmentation error:", err);
    return NextResponse.json(
      {
        error: "Segmentation inference failed",
        detail: err instanceof Error ? err.message : String(err),
        fallback: true,
      },
      { status: 500 }
    );
  }
}
