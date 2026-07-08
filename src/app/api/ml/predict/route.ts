import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";
import { readFileSync } from "fs";
import { join } from "path";

// ─── ONNX session cache (persists across warm invocations) ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionCache = new Map<string, any>();

// ─── ImageNet normalization constants ───

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const INPUT_SIZE = 224;
const CONTAM_THRESHOLD = 0.3;

// ─── Helpers ───

async function getOrLoadSession(modelName: string, fileUrl: string) {
  const cacheKey = `${modelName}_${fileUrl}`;

  if (sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey)!;
  }

  // Download model as ArrayBuffer (onnxruntime-web doesn't use filesystem)
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download model from ${fileUrl}: ${response.status}`
    );
  }
  const modelBuffer = await response.arrayBuffer();

  const ort = await import("onnxruntime-web");

  // Load WASM binary from the bundled node_modules file
  // Node.js ESM loader can't fetch from https:// and Vercel doesn't bundle .wasm
  const wasmPath = join(
    process.cwd(),
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"
  );
  ort.env.wasm.wasmBinary = readFileSync(wasmPath).buffer;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;

  const session = await ort.InferenceSession.create(
    new Uint8Array(modelBuffer)
  );
  sessionCache.set(cacheKey, session);
  return session;
}

async function preprocessImage(
  base64Image: string
): Promise<Float32Array> {
  const sharpModule = (await import("sharp")).default;

  // Decode base64 → resize 256 → center crop 224 → raw RGB
  const imageBuffer = Buffer.from(base64Image, "base64");

  const { data } = await sharpModule(imageBuffer)
    .resize(256, 256, { fit: "cover" })
    .extract({
      left: Math.floor((256 - INPUT_SIZE) / 2),
      top: Math.floor((256 - INPUT_SIZE) / 2),
      width: INPUT_SIZE,
      height: INPUT_SIZE,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert HWC RGB uint8 → NCHW float32 with ImageNet normalization
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const float32 = new Float32Array(3 * pixels);

  for (let i = 0; i < pixels; i++) {
    float32[i] = (data[i * 3] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    float32[pixels + i] =
      (data[i * 3 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    float32[2 * pixels + i] =
      (data[i * 3 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }

  return float32;
}

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...logits);
  const exps = Array.from(logits).map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// ─── Route handler ───

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const { cropType, image } = await request.json();

    if (!cropType || !image) {
      return NextResponse.json(
        { error: "cropType and image are required" },
        { status: 400 }
      );
    }

    // Map crop variant to model family: "oyster_blue" → "oyster"
    const modelFamily = cropType.split("_")[0];

    // Look up active contamination models for this crop family (ensemble = multiple folds)
    const contaminationModels = await prisma.mLModel.findMany({
      where: {
        name: { startsWith: "contamination" },
        cropType: modelFamily,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    // No models available → fallback response (Pi uses Claude vision instead)
    if (contaminationModels.length === 0) {
      return NextResponse.json(
        {
          fallback: true,
          reason: `No active contamination model for cropType "${modelFamily}"`,
          contamination: null,
          models_used: {},
          inference_ms: 0,
        },
        { status: 200 }
      );
    }

    const startTime = Date.now();

    // Preprocess image once: base64 → 224x224 NCHW float32 normalized
    const inputData = await preprocessImage(image);
    const ort = await import("onnxruntime-web");
    const inputTensor = new ort.Tensor("float32", inputData, [
      1,
      3,
      INPUT_SIZE,
      INPUT_SIZE,
    ]);

    // Run all fold models and collect softmax probabilities
    const allProbs: number[][] = [];

    for (const model of contaminationModels) {
      const session = await getOrLoadSession(
        `${model.name}_${model.cropType}_${model.version}`,
        model.fileUrl
      );

      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      console.log(
        `[ML] ${model.name}@v${model.version}: inputName="${inputName}" outputName="${outputName}"`
      );

      const results = await session.run({ [inputName]: inputTensor });
      const outputData = results[outputName].data as Float32Array;

      allProbs.push(softmax(outputData));
    }

    // Average softmax outputs across all folds
    const numClasses = allProbs[0].length;
    const avgProbs = new Array(numClasses).fill(0);
    for (const probs of allProbs) {
      for (let i = 0; i < numClasses; i++) {
        avgProbs[i] += probs[i];
      }
    }
    for (let i = 0; i < numClasses; i++) {
      avgProbs[i] /= allProbs.length;
    }

    // Class order: index 0 = contaminated, index 1 = healthy
    const contaminatedProb = avgProbs[0];
    const healthyProb = avgProbs[1];
    const isContaminated = contaminatedProb >= CONTAM_THRESHOLD;
    const confidence = isContaminated ? contaminatedProb : healthyProb;

    // Agreement: fraction of individual models that agree with ensemble decision
    const individualPreds = allProbs.map((p) => p[0] >= CONTAM_THRESHOLD);
    const agreement =
      individualPreds.filter((p) => p === isContaminated).length /
      allProbs.length;

    const inferenceMs = Date.now() - startTime;

    const modelVersions = contaminationModels.map(
      (m) => `${m.name}@v${m.version}`
    );

    return NextResponse.json(
      {
        contamination: {
          prediction: isContaminated ? "contaminated" : "healthy",
          confidence: Math.round(confidence * 1000) / 1000,
          probabilities: {
            contaminated: Math.round(contaminatedProb * 1000) / 1000,
            healthy: Math.round(healthyProb * 1000) / 1000,
          },
          agreement,
          threshold: CONTAM_THRESHOLD,
          alert: contaminatedProb > 0.7,
          needsClaudeCheck:
            contaminatedProb >= 0.3 && contaminatedProb < 0.7,
        },
        fallback: false,
        ensemble: {
          fold_count: allProbs.length,
          models: modelVersions,
        },
        models_used: {
          contamination: `v${contaminationModels[0].version} (${allProbs.length}-fold ensemble)`,
        },
        inference_ms: inferenceMs,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[ML] Prediction error:", err);
    return NextResponse.json(
      {
        error: "ML inference failed",
        detail: err instanceof Error ? err.message : String(err),
        stack:
          process.env.NODE_ENV === "development"
            ? err instanceof Error
              ? err.stack
              : undefined
            : undefined,
        fallback: true,
      },
      { status: 500 }
    );
  }
}
