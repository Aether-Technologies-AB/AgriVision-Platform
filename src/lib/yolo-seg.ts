// YOLOv8-seg output decoding, as pure functions over typed arrays.
//
// Split out of src/app/api/ml/segment/route.ts deliberately: every step below
// has already cost a debugging cycle in the reference implementation (see
// test-supervisor/lab/NOTEBOOK.md iterations 71-76), and none of them need a
// model file to exercise. src/lib/yolo-seg.test.ts drives all of it with
// synthetic tensors, so the decode can be verified without the 47.5 MB weights.
//
// Nothing here is contamination-aware and nothing here imports the ONNX
// runtime — it takes the two raw output tensors and returns polygons in
// ORIGINAL-image coordinates.

// ─── Letterbox geometry ─────────────────────────────────────────────────────

export type LetterboxGeometry = {
  /** Uniform scale applied to the original image before padding. */
  scale: number;
  padLeft: number;
  padTop: number;
  /** Square network input edge, e.g. 896. */
  inputSize: number;
  originalWidth: number;
  originalHeight: number;
  /** Scaled (pre-pad) content size, i.e. the non-grey region. */
  resizedWidth: number;
  resizedHeight: number;
};

/**
 * Aspect-preserving centred letterbox, matching what the preprocessor does with
 * sharp: resize to fit, then pad the remainder with grey (114).
 */
export function computeLetterbox(
  originalWidth: number,
  originalHeight: number,
  inputSize: number
): LetterboxGeometry {
  const scale = Math.min(inputSize / originalWidth, inputSize / originalHeight);
  const resizedWidth = Math.round(originalWidth * scale);
  const resizedHeight = Math.round(originalHeight * scale);
  return {
    scale,
    padLeft: Math.floor((inputSize - resizedWidth) / 2),
    padTop: Math.floor((inputSize - resizedHeight) / 2),
    inputSize,
    originalWidth,
    originalHeight,
    resizedWidth,
    resizedHeight,
  };
}

/** Letterbox pixel coords -> original-image pixel coords (undoes pad + scale). */
export function toOriginalX(x: number, g: LetterboxGeometry): number {
  return (x - g.padLeft) / g.scale;
}
export function toOriginalY(y: number, g: LetterboxGeometry): number {
  return (y - g.padTop) / g.scale;
}

/**
 * Anchor count a YOLOv8 head emits for a square input, summed over strides
 * 8/16/32. 896 -> 16464, 640 -> 8400. Used to catch an input-size assumption
 * that disagrees with the model, which otherwise decodes into confident
 * nonsense rather than raising.
 */
export function anchorsForInputSize(inputSize: number): number {
  return (
    (inputSize / 8) ** 2 + (inputSize / 16) ** 2 + (inputSize / 32) ** 2
  );
}

// ─── Small numeric helpers ──────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export type Box = { x1: number; y1: number; x2: number; y2: number };

function iou(a: Box, b: Box): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

// ─── Stage 1: raw candidates out of output0 ─────────────────────────────────

export type Candidate = {
  box: Box; // letterbox pixel space
  confidence: number;
  coeffs: Float32Array; // 32 mask coefficients
};

/**
 * output0 arrives as [1, 4 + numClasses + numCoeffs, numAnchors] — for this
 * single-class model, [1, 37, 16464]. It is CHANNEL-major: element (c, i) lives
 * at `c * numAnchors + i`, which is the transpose to [16464, 37] the decode
 * needs. Columns 0-3 are the box as cx,cy,w,h in letterbox pixels; column 4 is
 * the class confidence; columns 5-36 are the 32 mask coefficients.
 */
export function decodeCandidates(
  det: Float32Array,
  channels: number,
  numAnchors: number,
  confThreshold: number
): Candidate[] {
  const numCoeffs = channels - 5;
  if (numCoeffs <= 0) {
    throw new Error(
      `output0 has ${channels} channels; expected 5 + mask coefficients (single class)`
    );
  }

  const out: Candidate[] = [];
  for (let i = 0; i < numAnchors; i++) {
    const confidence = det[4 * numAnchors + i];
    if (confidence < confThreshold) continue;

    const cx = det[0 * numAnchors + i];
    const cy = det[1 * numAnchors + i];
    const w = det[2 * numAnchors + i];
    const h = det[3 * numAnchors + i];

    const coeffs = new Float32Array(numCoeffs);
    for (let c = 0; c < numCoeffs; c++) {
      coeffs[c] = det[(5 + c) * numAnchors + i];
    }

    out.push({
      box: { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 },
      confidence,
      coeffs,
    });
  }
  return out;
}

/** Greedy box NMS, highest confidence first. */
export function nms(candidates: Candidate[], iouThreshold: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const kept: Candidate[] = [];
  for (const cand of sorted) {
    let suppressed = false;
    for (const k of kept) {
      if (iou(cand.box, k.box) > iouThreshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) kept.push(cand);
  }
  return kept;
}

// ─── Stage 2: prototype masks ───────────────────────────────────────────────

export type ProtoMask = {
  /** sigmoid(coeffs . protos), proto resolution, zero outside the instance box. */
  values: Float32Array;
  /** values > 0.5, as 0/1. Used for the containment dedup and for ordering. */
  binary: Uint8Array;
  /** Count of set pixels in `binary`, at proto resolution. */
  area: number;
};

/**
 * sigmoid(coeffs . protos.reshape(32, mh*mw)).reshape(mh, mw), evaluated only
 * inside the instance's own box (everything outside is cropped away anyway) and
 * thresholded at 0.5.
 *
 * `protos` MUST be the [1, 32, mh, mw] prototype tensor (output1 — 224x224 at
 * 896 px input). Feeding a different 32-channel output here yields rectangular
 * masks that look plausible and are wrong.
 */
export function buildProtoMask(
  cand: Candidate,
  protos: Float32Array,
  numCoeffs: number,
  mh: number,
  mw: number,
  inputSize: number
): ProtoMask {
  const values = new Float32Array(mh * mw);
  const binary = new Uint8Array(mh * mw);
  const planeSize = mh * mw;

  // Instance box, projected from letterbox space into proto space.
  const sx = mw / inputSize;
  const sy = mh / inputSize;
  const bx1 = Math.max(0, Math.floor(cand.box.x1 * sx));
  const by1 = Math.max(0, Math.floor(cand.box.y1 * sy));
  const bx2 = Math.min(mw, Math.ceil(cand.box.x2 * sx));
  const by2 = Math.min(mh, Math.ceil(cand.box.y2 * sy));

  let area = 0;
  for (let y = by1; y < by2; y++) {
    for (let x = bx1; x < bx2; x++) {
      const p = y * mw + x;
      let acc = 0;
      for (let c = 0; c < numCoeffs; c++) {
        acc += cand.coeffs[c] * protos[c * planeSize + p];
      }
      const v = sigmoid(acc);
      values[p] = v;
      if (v > 0.5) {
        binary[p] = 1;
        area++;
      }
    }
  }

  return { values, binary, area };
}

/**
 * Mask-level containment dedup, run AFTER box NMS — box IoU cannot see a mask
 * nested inside a larger one, which is exactly what a whole-canopy detection
 * looks like next to the individual plants it swallows.
 *
 * Candidates are processed SMALLEST-FIRST. Largest-first inverts the test and
 * discards every real plant as a duplicate of the blob containing it — the bug
 * that turned a correct 2-instance result into 6 incorrect ones.
 *
 * The test is JOINT COVERAGE, not pairwise containment: a larger mask is
 * dropped when the masks already kept cover more than `containmentThreshold` of
 * IT. Pairwise ("drop the larger if it contains >T of any one kept mask") reads
 * the same but deletes real plants — measured on frame
 * 2026-09-09_07-01-55_scan_stop4, where a 1,559 px speck detected inside a
 * plant was kept first and then annihilated the 37,989 px plant containing it,
 * because that plant did indeed contain >80% of the speck. Joint coverage asks
 * the question that was actually meant: is this large mask already explained by
 * what we kept? A whole-canopy blob is (its plants tile it); a plant with one
 * speck in it is not (the speck covers 4% of it).
 */
export function containmentDedup<T extends { mask: ProtoMask }>(
  items: T[],
  containmentThreshold: number
): T[] {
  const ascending = [...items].sort((a, b) => a.mask.area - b.mask.area);
  const kept: T[] = [];

  for (const item of ascending) {
    if (item.mask.area === 0) continue;

    const own = item.mask.binary;
    let covered = 0;
    for (let p = 0; p < own.length; p++) {
      if (own[p] !== 1) continue;
      for (const k of kept) {
        if (k.mask.binary[p] === 1) {
          covered++;
          break;
        }
      }
    }

    if (covered / item.mask.area <= containmentThreshold) kept.push(item);
  }
  return kept;
}

// ─── Stage 3: proto mask -> polygon in original-image space ─────────────────

export type SubMask = {
  data: Uint8Array;
  width: number;
  height: number;
  /** Origin of the sub-rect in original-image pixels. */
  offsetX: number;
  offsetY: number;
};

/**
 * Rasterise one instance directly into ORIGINAL-image pixel space: upsample the
 * proto mask bilinearly (the sigmoid values, not the logits — matching
 * ultralytics, which sigmoids before interpolating), crop to the instance's own
 * box, and threshold at 0.5.
 *
 * Sampling straight into original coordinates rather than into letterbox
 * coordinates and transforming afterwards means the letterbox pad and scale are
 * undone exactly once, on the sampling grid, so the returned polygon and
 * `area_px` are already in the frame the caller measures.
 */
export function rasteriseToOriginal(
  cand: Candidate,
  mask: ProtoMask,
  mh: number,
  mw: number,
  g: LetterboxGeometry
): SubMask {
  const ox1 = Math.max(0, Math.floor(toOriginalX(cand.box.x1, g)));
  const oy1 = Math.max(0, Math.floor(toOriginalY(cand.box.y1, g)));
  const ox2 = Math.min(g.originalWidth, Math.ceil(toOriginalX(cand.box.x2, g)));
  const oy2 = Math.min(g.originalHeight, Math.ceil(toOriginalY(cand.box.y2, g)));

  const width = Math.max(0, ox2 - ox1);
  const height = Math.max(0, oy2 - oy1);
  const data = new Uint8Array(Math.max(0, width * height));
  if (width === 0 || height === 0) {
    return { data, width, height, offsetX: ox1, offsetY: oy1 };
  }

  // original px -> letterbox px -> proto px, with the half-pixel convention of
  // bilinear interpolation with align_corners=false.
  const sx = mw / g.inputSize;
  const sy = mh / g.inputSize;

  for (let yy = 0; yy < height; yy++) {
    const oy = oy1 + yy + 0.5; // sample at pixel centres
    const lby = oy * g.scale + g.padTop;
    const fy = Math.min(mh - 1, Math.max(0, (lby + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1i = Math.min(mh - 1, y0 + 1);
    const wy = fy - y0;

    for (let xx = 0; xx < width; xx++) {
      const ox = ox1 + xx + 0.5;
      const lbx = ox * g.scale + g.padLeft;
      const fx = Math.min(mw - 1, Math.max(0, (lbx + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1i = Math.min(mw - 1, x0 + 1);
      const wx = fx - x0;

      const v00 = mask.values[y0 * mw + x0];
      const v01 = mask.values[y0 * mw + x1i];
      const v10 = mask.values[y1i * mw + x0];
      const v11 = mask.values[y1i * mw + x1i];
      const v =
        v00 * (1 - wx) * (1 - wy) +
        v01 * wx * (1 - wy) +
        v10 * (1 - wx) * wy +
        v11 * wx * wy;

      if (v > 0.5) data[yy * width + xx] = 1;
    }
  }

  return { data, width, height, offsetX: ox1, offsetY: oy1 };
}

/**
 * Largest 8-connected component of a binary sub-mask, in place. Bilinear
 * upsampling of a proto mask routinely leaves a few detached specks near the
 * box corners; a plant is one blob, so keeping only the largest component
 * removes them without a morphology pass.
 */
export function largestComponent(sub: SubMask): { data: Uint8Array; area: number } {
  const { data, width, height } = sub;
  const labels = new Int32Array(width * height).fill(-1);
  const stack: number[] = [];
  let best = -1;
  let bestArea = 0;
  let current = 0;

  for (let start = 0; start < data.length; start++) {
    if (data[start] !== 1 || labels[start] !== -1) continue;
    let area = 0;
    stack.push(start);
    labels[start] = current;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      area++;
      const px = p % width;
      const py = (p - px) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (data[q] === 1 && labels[q] === -1) {
            labels[q] = current;
            stack.push(q);
          }
        }
      }
    }
    if (area > bestArea) {
      bestArea = area;
      best = current;
    }
    current++;
  }

  const out = new Uint8Array(width * height);
  if (best >= 0) {
    for (let p = 0; p < out.length; p++) {
      if (labels[p] === best) out[p] = 1;
    }
  }
  return { data: out, area: bestArea };
}

// Clockwise, starting north-west.
const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

/** Moore-neighbour boundary trace of a single-component binary sub-mask. */
export function traceContour(
  data: Uint8Array,
  width: number,
  height: number
): Array<[number, number]> {
  let sx = -1;
  let sy = -1;
  for (let y = 0; y < height && sy < 0; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === 1) {
        sx = x;
        sy = y;
        break;
      }
    }
  }
  if (sx < 0) return [];

  const isSet = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] === 1;

  const contour: Array<[number, number]> = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  // The start is the first set pixel in row-major order, so its west neighbour
  // is guaranteed background — a valid initial backtrack.
  let bx = sx - 1;
  let by = sy;

  const maxSteps = width * height * 8 + 8;
  for (let step = 0; step < maxSteps; step++) {
    const bi = NEIGHBOURS_8.findIndex(
      ([dx, dy]) => cx + dx === bx && cy + dy === by
    );
    if (bi < 0) break;

    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const i = (bi + k) % 8;
      const nx = cx + NEIGHBOURS_8[i][0];
      const ny = cy + NEIGHBOURS_8[i][1];
      if (isSet(nx, ny)) {
        // New backtrack is the neighbour examined immediately before this one.
        const prev = (i + 7) % 8;
        bx = cx + NEIGHBOURS_8[prev][0];
        by = cy + NEIGHBOURS_8[prev][1];
        cx = nx;
        cy = ny;
        moved = true;
        break;
      }
    }
    if (!moved) break; // isolated pixel
    if (cx === sx && cy === sy) break;
    contour.push([cx, cy]);
  }

  return contour;
}

/** Douglas-Peucker simplification of an open polyline (endpoints preserved). */
export function simplifyPolygon(
  points: Array<[number, number]>,
  tolerance: number
): Array<[number, number]> {
  if (points.length <= 2 || tolerance <= 0) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    if (last <= first + 1) continue;

    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const norm = Math.hypot(dx, dy);

    let maxDist = -1;
    let maxIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const dist =
        norm === 0
          ? Math.hypot(px - x1, py - y1)
          : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm;
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > tolerance && maxIndex > 0) {
      keep[maxIndex] = 1;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }

  const out: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i] === 1) out.push(points[i]);
  }
  return out;
}
