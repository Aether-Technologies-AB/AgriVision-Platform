// Integration test for POST /api/ml/segment — hits the real database and pulls
// the real .onnx from Vercel Blob, the same way the route does in production.
//
// The acceptance check this file encodes: for the rail1 frame that every model
// in test-supervisor/lab/runs/F1-MODELS was compared on
// (2026-09-08 stop 4), the endpoint must return 11 instances, matching
// NOTEBOOK.md iteration 74 ("11 instances ... masks containing exactly one cup
// centre 11 of 11") and the ultralytics reference run reproduced from
// best.onnx on 2026-09-09.
//
// It NEVER activates the real lettuce model row. `isActive` must stay false
// until the model is retrained on mature-canopy frames from the harvest, so the
// live-path cases here register a DISPOSABLE MLModel row under a throwaway
// cropType pointing at the same Blob URL, and delete it in `after`. That
// exercises every line of the route — lookup, session load, preprocessing,
// decode, response shape — while the production row stays inactive.

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let prisma: typeof import("@/lib/prisma").prisma;
let POST: typeof import("./route").POST;
let NextRequest: typeof import("next/server").NextRequest;

// Same Blob object the production row points at (see
// scripts/20260909_register_lettuce_segmentation.ts).
const MODEL_URL =
  "https://igigqhuyo7zl7pbl.public.blob.vercel-storage.com/models/lettuce/segmentation_v1_640.onnx";

// Disposable crop family, so the lookup finds the test row and never the real
// `lettuce` one (which stays isActive: false).
const TEST_CROP = "segtestcrop";

const FIXTURES = join(__dirname, "__fixtures__");

let apiKeyPlaintext: string;
let apiKeyId: string;
let testModelId: string;

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function frame(name: string): string {
  return readFileSync(join(FIXTURES, name)).toString("base64");
}

before(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  ({ POST } = await import("./route"));
  ({ NextRequest } = await import("next/server"));

  const org = await prisma.organization.findFirstOrThrow();

  apiKeyPlaintext = `agv_test_${randomUUID().replace(/-/g, "")}`;
  const key = await prisma.apiKey.create({
    data: {
      name: "TEST — ml/segment suite (safe to delete)",
      keyHash: hashApiKey(apiKeyPlaintext),
      prefix: apiKeyPlaintext.slice(0, 8),
      organizationId: org.id,
    },
  });
  apiKeyId = key.id;

  const model = await prisma.mLModel.create({
    data: {
      name: "segmentation",
      version: "1.0.0-test",
      cropType: TEST_CROP,
      fileUrl: MODEL_URL,
      fileSizeMb: 47.5,
      accuracy: 0.836,
      epochs: 150,
      trainedOn: "TEST fixture row — deleted by this suite",
      isActive: true,
    },
  });
  testModelId = model.id;
});

after(async () => {
  await prisma.mLModel.delete({ where: { id: testModelId } });
  await prisma.apiKey.delete({ where: { id: apiKeyId } });
  await prisma.$disconnect();
});

function buildRequest(body: unknown): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost/api/ml/segment", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKeyPlaintext}`,
    },
    body: JSON.stringify(body),
  });
}

type SegResponse = {
  fallback: boolean;
  segmentation: {
    instances: Array<{
      polygon: Array<[number, number]>;
      confidence: number;
      area_px: number;
    }>;
    model: string;
    inference_ms: number;
  } | null;
  reason?: string;
};

describe("POST /api/ml/segment", () => {
  it("reproduces the F1-MODELS reference frame: 11 instances on rail1 2026-09-08 stop 4", async () => {
    const res = await POST(
      buildRequest({ cropType: TEST_CROP, image: frame("rail1_2026-09-08_stop4_rgb.jpg") })
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as SegResponse;

    assert.equal(body.fallback, false);
    assert.ok(body.segmentation);
    assert.equal(
      body.segmentation.instances.length,
      11,
      `expected 11 instances on the F1-MODELS reference frame (NOTEBOOK iteration 74), got ${body.segmentation.instances.length}`
    );

    // Areas, against the ultralytics reference run over the same best.onnx.
    // Sorted descending by area in the response, so this is a paired compare.
    const referenceAreas = [
      32844, 32144, 31947, 27583, 26796, 25899, 23516, 17071, 16023, 15520, 13487,
    ];
    const areas = body.segmentation.instances.map((i) => i.area_px);
    for (let i = 0; i < referenceAreas.length; i++) {
      const ratio = areas[i] / referenceAreas[i];
      assert.ok(
        ratio > 0.95 && ratio < 1.05,
        `instance ${i}: area ${areas[i]} vs reference ${referenceAreas[i]} (ratio ${ratio.toFixed(3)}) outside +-5%`
      );
    }
  });

  it("returns polygons, not raster masks, in original-image coordinates", async () => {
    const res = await POST(
      buildRequest({ cropType: TEST_CROP, image: frame("rail1_2026-09-09_stop6_rgb.jpg") })
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as SegResponse;
    assert.ok(body.segmentation);
    assert.equal(body.segmentation.instances.length, 13);
    assert.equal(body.segmentation.model, "segmentation@v1.0.0-test");

    for (const inst of body.segmentation.instances) {
      assert.ok(Array.isArray(inst.polygon) && inst.polygon.length >= 3);
      assert.ok(inst.confidence > 0 && inst.confidence <= 1);
      assert.ok(inst.area_px > 0);
      // The source frames are 848x480. Coordinates must be in that frame, not
      // in the 896x896 letterbox — a small tolerance for the half-pixel
      // sampling grid at the border.
      for (const [x, y] of inst.polygon) {
        assert.ok(x >= -1 && x <= 849, `polygon x ${x} outside the original frame`);
        assert.ok(y >= -1 && y <= 481, `polygon y ${y} outside the original frame`);
      }
    }
  });

  it("fails closed: a crop with no active segmentation model gets the fallback, never another crop's model", async () => {
    // "basil" is Floor 2 / rail2. The model has only ever seen lettuce.
    const res = await POST(
      buildRequest({ cropType: "basil", image: frame("rail1_2026-09-08_stop4_rgb.jpg") })
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as SegResponse;
    assert.equal(body.fallback, true);
    assert.equal(body.segmentation, null);
    assert.match(body.reason ?? "", /basil/);
  });

  it("the real lettuce row stays inactive, so live lettuce traffic also gets the fallback", async () => {
    const row = await prisma.mLModel.findUnique({
      where: { name_version: { name: "segmentation", version: "1.0.0" } },
    });
    assert.ok(row, "the production segmentation row should be registered");
    assert.equal(
      row.isActive,
      false,
      "segmentation@1.0.0 must stay isActive=false until it is retrained on mature-canopy frames"
    );

    const res = await POST(
      buildRequest({ cropType: "lettuce", image: frame("rail1_2026-09-08_stop4_rgb.jpg") })
    );
    const body = (await res.json()) as SegResponse;
    assert.equal(body.fallback, true);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/ml/segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cropType: TEST_CROP, image: "" }),
      })
    );
    assert.equal(res.status, 401);
  });

  it("requires cropType and image", async () => {
    const res = await POST(buildRequest({ cropType: TEST_CROP }));
    assert.equal(res.status, 400);
  });
});
