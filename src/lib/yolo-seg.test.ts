// Unit tests for the YOLOv8-seg decode, driven by synthetic tensors so the
// whole thing is exercised without the 47 MB weights or a network call.
//
// Every case here corresponds to a documented failure mode from
// test-supervisor/DEPLOY-PROMPT.md or one found while building this route.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
  toOriginalX,
  toOriginalY,
  traceContour,
  type Candidate,
  type ProtoMask,
} from "./yolo-seg";

describe("letterbox geometry", () => {
  it("centres an 848x480 frame in a 896 box and inverts exactly", () => {
    const g = computeLetterbox(848, 480, 896);
    assert.equal(g.resizedWidth, 896);
    assert.equal(g.resizedHeight, 507);
    assert.equal(g.padLeft, 0);
    assert.equal(g.padTop, 194); // matches ultralytics' round(dh - 0.1)

    // Round-trip the frame corners through the mapping used to return coords.
    assert.ok(Math.abs(toOriginalX(g.padLeft, g) - 0) < 1e-9);
    assert.ok(Math.abs(toOriginalY(g.padTop, g) - 0) < 1e-9);
    assert.ok(Math.abs(toOriginalX(g.padLeft + g.resizedWidth, g) - 848) < 1e-9);
    // resizedHeight is an integer number of pixels (507), so the inverse lands
    // within half a pixel of 480 rather than exactly on it.
    assert.ok(Math.abs(toOriginalY(g.padTop + g.resizedHeight, g) - 480) < 0.5);
  });

  it("anchor counts match the shapes the exports actually emit", () => {
    assert.equal(anchorsForInputSize(896), 16464);
    assert.equal(anchorsForInputSize(640), 8400);
  });
});

describe("decodeCandidates", () => {
  // output0 is [1, C, N] and CHANNEL-major: element (c, i) at c*N + i. Reading
  // it as row-major would transpose boxes into coefficients silently.
  it("reads the channel-major layout and splits box / conf / coefficients", () => {
    const C = 37;
    const N = 4;
    const det = new Float32Array(C * N);
    const put = (c: number, i: number, v: number) => {
      det[c * N + i] = v;
    };
    // one strong candidate at index 2
    put(0, 2, 100); // cx
    put(1, 2, 50); // cy
    put(2, 2, 20); // w
    put(3, 2, 10); // h
    put(4, 2, 0.9); // conf
    for (let k = 0; k < 32; k++) put(5 + k, 2, k / 100);
    // one below threshold at index 0
    put(4, 0, 0.1);

    const cands = decodeCandidates(det, C, N, 0.25);
    assert.equal(cands.length, 1);
    const c = cands[0];
    assert.deepEqual(c.box, { x1: 90, y1: 45, x2: 110, y2: 55 });
    // Float32Array round-trip, so compare with a tolerance.
    assert.ok(Math.abs(c.confidence - 0.9) < 1e-6);
    assert.equal(c.coeffs.length, 32);
    assert.ok(Math.abs(c.coeffs[31] - 0.31) < 1e-6);
  });
});

function candidateAt(x1: number, y1: number, x2: number, y2: number, conf: number): Candidate {
  return { box: { x1, y1, x2, y2 }, confidence: conf, coeffs: new Float32Array(32) };
}

describe("nms", () => {
  it("suppresses a heavily overlapping box and keeps a disjoint one", () => {
    const kept = nms(
      [
        candidateAt(0, 0, 100, 100, 0.9),
        candidateAt(5, 5, 105, 105, 0.8), // IoU ~0.82 with the first
        candidateAt(500, 500, 600, 600, 0.7), // disjoint
      ],
      0.6
    );
    assert.equal(kept.length, 2);
    assert.deepEqual(
      kept.map((k) => k.confidence),
      [0.9, 0.7]
    );
  });
});

function maskOf(area: number, set: (p: number) => boolean, size = 100): ProtoMask {
  const binary = new Uint8Array(size);
  const values = new Float32Array(size);
  let n = 0;
  for (let p = 0; p < size; p++) {
    if (set(p)) {
      binary[p] = 1;
      values[p] = 1;
      n++;
    }
  }
  assert.equal(n, area);
  return { values, binary, area: n };
}

describe("containmentDedup", () => {
  // The bug the DEPLOY-PROMPT calls out: largest-first discards every real
  // plant as a duplicate of the whole-canopy blob that contains them.
  it("drops a whole-canopy blob and keeps the plants that tile it", () => {
    const plantA = { mask: maskOf(40, (p) => p < 40), id: "A" };
    const plantB = { mask: maskOf(40, (p) => p >= 40 && p < 80), id: "B" };
    const canopy = { mask: maskOf(80, (p) => p < 80), id: "canopy" };

    const kept = containmentDedup([canopy, plantA, plantB], 0.8);
    assert.deepEqual(
      kept.map((k) => k.id).sort(),
      ["A", "B"],
      "the two plants must survive and the blob containing both must not"
    );
  });

  // Regression: measured on 2026-09-09_07-01-55_scan_stop4. A pairwise
  // "larger contains >80% of a kept smaller" test deleted a 37,989 px plant
  // because a 1,559 px speck had been detected inside it.
  it("does NOT let a small speck inside a plant delete that plant", () => {
    const speck = { mask: maskOf(4, (p) => p >= 20 && p < 24), id: "speck" };
    const plant = { mask: maskOf(60, (p) => p < 60), id: "plant" };

    const kept = containmentDedup([plant, speck], 0.8);
    assert.deepEqual(
      kept.map((k) => k.id).sort(),
      ["plant", "speck"],
      "a speck covering 7% of a plant must not remove it"
    );
  });

  it("keeps two plants that merely touch", () => {
    const a = { mask: maskOf(30, (p) => p < 30), id: "a" };
    const b = { mask: maskOf(30, (p) => p >= 25 && p < 55), id: "b" }; // 17% shared
    assert.equal(containmentDedup([a, b], 0.8).length, 2);
  });
});

describe("buildProtoMask", () => {
  it("thresholds sigmoid(coeffs . protos) at 0.5 and stays inside the box", () => {
    const mh = 4;
    const mw = 4;
    const numCoeffs = 2;
    const protos = new Float32Array(numCoeffs * mh * mw);
    // channel 0 positive everywhere, channel 1 unused
    for (let p = 0; p < mh * mw; p++) protos[p] = 10;

    const cand: Candidate = {
      // box covers the top-left quadrant only, in an input space of 8 px
      box: { x1: 0, y1: 0, x2: 4, y2: 4 },
      confidence: 0.9,
      coeffs: Float32Array.from([1, 0]),
    };
    const mask = buildProtoMask(cand, protos, numCoeffs, mh, mw, 8);

    assert.equal(mask.area, 4, "only the 2x2 proto region inside the box is set");
    assert.equal(mask.binary[0], 1);
    assert.equal(mask.binary[mh * mw - 1], 0, "outside the box must stay unset");
  });
});

describe("rasteriseToOriginal", () => {
  it("returns a sub-mask positioned in original-image coordinates", () => {
    const g = computeLetterbox(848, 480, 896);
    const mh = 160;
    const mw = 160;
    const mask: ProtoMask = {
      values: new Float32Array(mh * mw).fill(1), // everything above threshold
      binary: new Uint8Array(mh * mw).fill(1),
      area: mh * mw,
    };
    // a box in letterbox space corresponding to roughly x 100..200, y 0..100
    const x1 = 100 * g.scale + g.padLeft;
    const y1 = 0 * g.scale + g.padTop;
    const x2 = 200 * g.scale + g.padLeft;
    const y2 = 100 * g.scale + g.padTop;
    const cand = candidateAt(x1, y1, x2, y2, 0.9);

    const sub = rasteriseToOriginal(cand, mask, mh, mw, g);
    assert.equal(sub.offsetX, 100);
    assert.equal(sub.offsetY, 0);
    assert.equal(sub.width, 100);
    assert.equal(sub.height, 100);
    assert.equal(sub.data[0], 1);
  });

  it("clamps to the frame instead of emitting negative coordinates", () => {
    const g = computeLetterbox(848, 480, 896);
    const mask: ProtoMask = {
      values: new Float32Array(160 * 160).fill(1),
      binary: new Uint8Array(160 * 160).fill(1),
      area: 160 * 160,
    };
    // a box running off the left/top of the frame
    const cand = candidateAt(-500, -500, 200, 200, 0.9);
    const sub = rasteriseToOriginal(cand, mask, 160, 160, g);
    assert.ok(sub.offsetX >= 0 && sub.offsetY >= 0);
    assert.ok(sub.offsetX + sub.width <= 848);
    assert.ok(sub.offsetY + sub.height <= 480);
  });
});

describe("largestComponent", () => {
  it("keeps the biggest blob and drops detached upsampling specks", () => {
    const w = 10;
    const h = 10;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) data[y * w + x] = 1; // 25 px
    data[9 * w + 9] = 1; // speck
    const { data: out, area } = largestComponent({ data, width: w, height: h, offsetX: 0, offsetY: 0 });
    assert.equal(area, 25);
    assert.equal(out[9 * w + 9], 0);
  });
});

describe("traceContour + simplifyPolygon", () => {
  it("traces a rectangle's boundary and simplifies it to its corners", () => {
    const w = 12;
    const h = 12;
    const data = new Uint8Array(w * h);
    for (let y = 2; y < 10; y++) for (let x = 3; x < 9; x++) data[y * w + x] = 1;

    const contour = traceContour(data, w, h);
    assert.ok(contour.length >= 8, "boundary should be walked");
    // every traced point is a set pixel on the boundary
    for (const [x, y] of contour) assert.equal(data[y * w + x], 1);

    const simplified = simplifyPolygon(contour, 1.0);
    assert.ok(
      simplified.length >= 3 && simplified.length <= 6,
      `a rectangle should simplify to ~4 corners, got ${simplified.length}`
    );
  });

  it("returns nothing for an empty mask rather than throwing", () => {
    assert.deepEqual(traceContour(new Uint8Array(16), 4, 4), []);
  });

  it("terminates on a single isolated pixel", () => {
    const data = new Uint8Array(16);
    data[5] = 1;
    const c = traceContour(data, 4, 4);
    assert.equal(c.length, 1);
  });
});
