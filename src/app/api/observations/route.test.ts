// Integration test — hits the real database (no shadow DB available; the
// baseline migration is corrupted, see migration.sql header). Proves the
// SiteObservation unique constraint actually dedupes on repost, for BOTH the
// FUSED case (viewAngleDeg null — the one NULLS NOT DISTINCT exists to fix)
// and a normal per-view record as a control. This is the test referenced by
// the "regenerating this constraint will silently break fused-row
// idempotency" warnings in schema.prisma and the migration SQL — if someone
// ever "fixes" the constraint back to plain UNIQUE, this test starts failing
// instead of the breakage being silent.
//
// Runs against Pilot Basement's real Floor 1 zone (rail1), using disposable
// TEST-prefixed cycleIds cleaned up after each case, plus a throwaway API
// key created in `before` and deleted in `after`. Same disposable-fixture
// pattern as scripts/20260713_create_inference_worker_fixture.ts.

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

// Deferred to runtime inside before() (not static imports), deliberately: ES
// module `import` bindings are evaluated before any of this file's own
// top-level statements run — so a static `import { prisma } from
// "@/lib/prisma"` above would construct the PrismaPg adapter (which reads
// process.env.DATABASE_URL at module load time) BEFORE the dotenv config()
// calls above ever run, leaving DATABASE_URL undefined. Top-level await isn't
// an option either — this repo has no "type": "module", so tsx compiles
// tests to CJS, which rejects top-level await. Loading these three via
// `await import(...)` inside before() guarantees config() has already run
// by the time they're evaluated. Types only, via `typeof import(...)` —
// erased at compile time, no runtime import.
let prisma: typeof import("@/lib/prisma").prisma;
let POST: typeof import("./route").POST;
let NextRequest: typeof import("next/server").NextRequest;

const FLOOR1_ZONE_ID = "cmr83i8mv0005apc9ftndmn3n"; // Pilot Basement / Floor 1 / rail1

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

let apiKeyPlaintext: string;
let apiKeyId: string;

before(async () => {
  ({ prisma } = await import("@/lib/prisma"));
  ({ POST } = await import("./route"));
  ({ NextRequest } = await import("next/server"));

  const zone = await prisma.zone.findUniqueOrThrow({
    where: { id: FLOOR1_ZONE_ID },
    include: { farm: true },
  });

  apiKeyPlaintext = `agv_test_${randomUUID().replace(/-/g, "")}`;
  const created = await prisma.apiKey.create({
    data: {
      name: "TEST — observations idempotency suite (safe to delete)",
      keyHash: hashApiKey(apiKeyPlaintext),
      prefix: apiKeyPlaintext.slice(0, 8),
      organizationId: zone.farm.organizationId,
      farmId: zone.farmId,
    },
  });
  apiKeyId = created.id;
});

after(async () => {
  await prisma.apiKey.delete({ where: { id: apiKeyId } });
  await prisma.$disconnect();
});

function buildRequest(body: unknown): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost/api/observations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKeyPlaintext}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/observations — repost idempotency", () => {
  it("area-v2 coexists with both legacy methods, persists quality and remains idempotent", async () => {
    const cycleId = `TEST-area-v2-${randomUUID()}`;
    const base = { rail: "rail1", cycle_id: cycleId, site_id: "test_area_v2", global_row: 1,
      channel: 1, stop: 1, view_angle_deg: 0, is_fused: false, is_primary_view: true,
      captured_at: "2026-07-16_12-27-24", plant_present: false, reject_reason: "pale", schema: 3 };
    const meta = {
      algorithm_version: "seg-area-v2", implementation_revision: "numpy-rf-1",
      vegetation_model_sha256: "4c62c1364482f0bb518db6c8628375700856327b0f01d5e61f8e5eebc3da551f",
      runtime_model_sha256: "f44b1798deddfe0c6b9d6154fca8cbc8d86ff68375f0ce87cdf68f2a909eb008",
      vegetation_threshold: 0.5, ownership_rule: "nearest-claimant-row-desc-channel-asc-v1",
      raw_polygon_px: 120, background_removed_px: 10, ownership_removed_px: 10,
      raw_polygon_area_cm2: null, median_depth_mm: null, valid_depth_px: 19, depth_valid_pct: 19,
      frame_edge_distances_px: { left: 0, right: 10, top: 10, bottom: 10 },
      quality_flags: ["near_frame_edge", "low_depth_support", "insufficient_depth"], presence_source: "seg-v1",
    };
    const records = [
      { ...base, method: "gate", area_cm2: 1, height_mm_mean: 20 },
      { ...base, method: "seg-v1", area_cm2: 2, height_mm_mean: 21 },
      { ...base, method: "seg-area-v2", area_cm2: null, area_px: 100, fx: 400,
        depth_valid_pct: 19, measurement_meta: meta },
    ];
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await POST(buildRequest({ zoneId: FLOOR1_ZONE_ID, records }));
        assert.equal(res.status, 201, JSON.stringify(await res.json()));
      }
      const rows = await prisma.siteObservation.findMany({ where: { cycleId }, orderBy: { method: "asc" } });
      assert.equal(rows.length, 3);
      const v2 = rows.find(r => r.method === "seg-area-v2")!;
      assert.deepEqual(v2.measurementMeta, meta);
      assert.equal(v2.areaCm2, null);
      assert.equal(v2.heightMmMean, null);
      assert.equal(v2.plantPresent, false);
      assert.equal(rows.find(r => r.method === "gate")!.heightMmMean, 20);
      assert.equal(rows.find(r => r.method === "seg-v1")!.heightMmMean, 21);
    } finally {
      await prisma.siteObservation.deleteMany({ where: { cycleId } });
    }
  });
  it("FUSED record (viewAngleDeg null): reposting the identical record does not duplicate it", async () => {
    const cycleId = `TEST-fused-${randomUUID()}`;
    const siteId = "test_site_fused";
    const record = {
      rail: "rail1",
      cycle_id: cycleId,
      site_id: siteId,
      global_row: 1,
      channel: 1,
      stop: 6,
      view_angle_deg: "fused",
      is_fused: true,
      n_views_fused: 3,
      fusion_gain_pct: 46.8,
      is_primary_view: false,
      captured_at: "2026-07-16_12-27-24",
      plant_present: true,
      area_px: 1200,
      canopy_volume_cm3: 88.4,
      schema: 2,
    };

    try {
      const res1 = await POST(buildRequest({ zoneId: FLOOR1_ZONE_ID, records: [record] }));
      assert.equal(res1.status, 201, "first post should succeed");
      const body1 = (await res1.json()) as { ok: number; failed: number };
      assert.equal(body1.ok, 1);
      assert.equal(body1.failed, 0);

      // Identical repost — same cycle, same site, same fused record.
      const res2 = await POST(buildRequest({ zoneId: FLOOR1_ZONE_ID, records: [record] }));
      assert.equal(res2.status, 201, "repost should succeed, not error");
      const body2 = (await res2.json()) as { ok: number; failed: number };
      assert.equal(body2.ok, 1);
      assert.equal(body2.failed, 0);

      const rows = await prisma.siteObservation.findMany({
        where: { rail: "rail1", cycleId, siteId, isFused: true },
      });
      assert.equal(
        rows.length,
        1,
        `expected exactly 1 fused row for (rail1, ${cycleId}, ${siteId}) after two identical posts, found ${rows.length}. ` +
          `If this fails, the DB constraint is no longer NULLS NOT DISTINCT — a plain UNIQUE does not dedupe null viewAngleDeg.`
      );
      assert.equal(rows[0].viewAngleDeg, null);
      assert.equal(rows[0].canopyVolumeCm3, 88.4);
    } finally {
      await prisma.siteObservation.deleteMany({ where: { cycleId } });
    }
  });

  it("control: a normal per-view record (viewAngleDeg = 0.0) also does not duplicate on repost", async () => {
    const cycleId = `TEST-normal-${randomUUID()}`;
    const siteId = "test_site_normal";
    const record = {
      rail: "rail1",
      cycle_id: cycleId,
      site_id: siteId,
      global_row: 1,
      channel: 1,
      stop: 6,
      view_angle_deg: 0.0,
      is_primary_view: true,
      captured_at: "2026-07-16_12-27-24",
      plant_present: true,
      area_px: 900,
      area_cm2: 42.1,
      schema: 2,
    };

    try {
      const res1 = await POST(buildRequest({ zoneId: FLOOR1_ZONE_ID, records: [record] }));
      assert.equal(res1.status, 201);
      const body1 = (await res1.json()) as { ok: number; failed: number };
      assert.equal(body1.ok, 1);

      const res2 = await POST(buildRequest({ zoneId: FLOOR1_ZONE_ID, records: [record] }));
      assert.equal(res2.status, 201);
      const body2 = (await res2.json()) as { ok: number; failed: number };
      assert.equal(body2.ok, 1);

      const rows = await prisma.siteObservation.findMany({
        where: { rail: "rail1", cycleId, siteId, isFused: false },
      });
      assert.equal(
        rows.length,
        1,
        `expected exactly 1 row for (rail1, ${cycleId}, ${siteId}, 0.0) after two identical posts, found ${rows.length}`
      );
      assert.equal(rows[0].viewAngleDeg, 0.0);
      assert.equal(rows[0].areaCm2, 42.1);
    } finally {
      await prisma.siteObservation.deleteMany({ where: { cycleId } });
    }
  });

  it("distinct view angles for the same site+cycle remain separate rows (not collapsed by the unique key)", async () => {
    const cycleId = `TEST-distinct-${randomUUID()}`;
    const siteId = "test_site_distinct";
    const angles = [-18.1, 0.0, 18.1];

    try {
      for (const angle of angles) {
        const res = await POST(
          buildRequest({
            zoneId: FLOOR1_ZONE_ID,
            records: [
              {
                rail: "rail1",
                cycle_id: cycleId,
                site_id: siteId,
                global_row: 1,
                channel: 1,
                stop: 6,
                view_angle_deg: angle,
                is_primary_view: angle === 0.0,
                captured_at: "2026-07-16_12-27-24",
                plant_present: true,
                area_px: 900,
                schema: 2,
              },
            ],
          })
        );
        assert.equal(res.status, 201);
      }

      const rows = await prisma.siteObservation.findMany({
        where: { rail: "rail1", cycleId, siteId },
      });
      assert.equal(rows.length, 3, "3 distinct view angles must produce 3 rows, not be deduped together");
    } finally {
      await prisma.siteObservation.deleteMany({ where: { cycleId } });
    }
  });

  // ── `method` discriminator (migration 20260909100000) ────────────────────
  //
  // The unique key gained `method` so a cycle can be measured twice — once by
  // the production ExG/ROI gate and once by the segmentation model. Before it,
  // a model-derived row upserted straight over the production row.

  it("gate and seg-v1 FUSED rows for the same site+cycle coexist; neither overwrites the other", async () => {
    const cycleId = `TEST-method-fused-${randomUUID()}`;
    const siteId = "test_site_method_fused";
    const base = {
      rail: "rail1",
      cycle_id: cycleId,
      site_id: siteId,
      global_row: 1,
      channel: 1,
      stop: 6,
      view_angle_deg: "fused",
      is_fused: true,
      n_views_fused: 3,
      is_primary_view: false,
      captured_at: "2026-07-16_12-27-24",
      plant_present: true,
      schema: 3,
    };

    try {
      const res = await POST(
        buildRequest({
          zoneId: FLOOR1_ZONE_ID,
          records: [
            { ...base, area_px: 1000, canopy_volume_cm3: 50.0 }, // method omitted -> "gate"
            { ...base, method: "seg-v1", area_px: 2000, canopy_volume_cm3: 90.0 },
          ],
        })
      );
      assert.equal(res.status, 201);
      const body = (await res.json()) as { ok: number; failed: number };
      assert.equal(body.ok, 2);
      assert.equal(body.failed, 0);

      const rows = await prisma.siteObservation.findMany({
        where: { rail: "rail1", cycleId, siteId, isFused: true },
        orderBy: { method: "asc" },
      });
      assert.equal(rows.length, 2, "the two methods must produce two rows, not one overwriting the other");
      assert.equal(rows[0].method, "gate");
      assert.equal(rows[0].areaPx, 1000);
      assert.equal(rows[0].canopyVolumeCm3, 50.0);
      assert.equal(rows[1].method, "seg-v1");
      assert.equal(rows[1].areaPx, 2000);
      assert.equal(rows[1].canopyVolumeCm3, 90.0);

      // And each is still individually idempotent on repost.
      const res2 = await POST(
        buildRequest({
          zoneId: FLOOR1_ZONE_ID,
          records: [
            { ...base, area_px: 1000, canopy_volume_cm3: 50.0 },
            { ...base, method: "seg-v1", area_px: 2000, canopy_volume_cm3: 90.0 },
          ],
        })
      );
      assert.equal(res2.status, 201);
      const after = await prisma.siteObservation.findMany({
        where: { rail: "rail1", cycleId, siteId, isFused: true },
      });
      assert.equal(after.length, 2, "reposting both methods must still yield exactly 2 rows");
    } finally {
      await prisma.siteObservation.deleteMany({ where: { cycleId } });
    }
  });

  it("gate and seg-v1 PER-VIEW rows at the same view angle coexist (the typed upsert key carries method)", async () => {
    const cycleId = `TEST-method-view-${randomUUID()}`;
    const siteId = "test_site_method_view";
    const base = {
      rail: "rail1",
      cycle_id: cycleId,
      site_id: siteId,
      global_row: 1,
      channel: 1,
      stop: 6,
      view_angle_deg: 0.0,
      is_primary_view: true,
      captured_at: "2026-07-16_12-27-24",
      plant_present: true,
      schema: 3,
    };

    try {
      await POST(
        buildRequest({
          zoneId: FLOOR1_ZONE_ID,
          records: [
            { ...base, area_cm2: 40.0 },
            { ...base, method: "seg-v1", area_cm2: 60.0 },
          ],
        })
      );
      const rows = await prisma.siteObservation.findMany({
        where: { rail: "rail1", cycleId, siteId, isFused: false },
        orderBy: { method: "asc" },
      });
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => r.method), ["gate", "seg-v1"]);
      assert.deepEqual(rows.map((r) => r.areaCm2), [40.0, 60.0]);
    } finally {
      await prisma.siteObservation.deleteMany({ where: { cycleId } });
    }
  });

  it("a seg-v1 fused row derives colour traits from its seg-v1 siblings, not the gate ones", async () => {
    const cycleId = `TEST-method-derive-${randomUUID()}`;
    const siteId = "test_site_method_derive";
    const common = {
      rail: "rail1",
      cycle_id: cycleId,
      site_id: siteId,
      global_row: 1,
      channel: 1,
      stop: 6,
      captured_at: "2026-07-16_12-27-24",
      plant_present: true,
      schema: 3,
    };
    const view = (method: string, angle: number, exg: number) => ({
      ...common,
      ...(method === "gate" ? {} : { method }),
      view_angle_deg: angle,
      is_primary_view: angle === 0,
      area_px: 1000,
      exg_mean: exg,
      coverage: exg,
    });
    const fused = (method: string) => ({
      ...common,
      ...(method === "gate" ? {} : { method }),
      view_angle_deg: "fused",
      is_fused: true,
      n_views_fused: 2,
      is_primary_view: false,
      area_px: 1500,
    });

    try {
      const res = await POST(
        buildRequest({
          zoneId: FLOOR1_ZONE_ID,
          records: [
            view("gate", -18.1, 0.10),
            view("gate", 0.0, 0.10),
            view("seg-v1", -18.1, 0.90),
            view("seg-v1", 0.0, 0.90),
            fused("gate"),
            fused("seg-v1"),
          ],
        })
      );
      assert.equal(res.status, 201);

      const rows = await prisma.siteObservation.findMany({
        where: { rail: "rail1", cycleId, siteId, isFused: true },
        orderBy: { method: "asc" },
      });
      assert.equal(rows.length, 2);

      const gateFused = rows.find((r) => r.method === "gate")!;
      const segFused = rows.find((r) => r.method === "seg-v1")!;

      assert.ok(gateFused.exgMean !== null && Math.abs(gateFused.exgMean - 0.10) < 1e-6,
        `gate fused row should derive 0.10 from its gate siblings, got ${gateFused.exgMean}`);
      assert.ok(segFused.exgMean !== null && Math.abs(segFused.exgMean - 0.90) < 1e-6,
        `seg-v1 fused row must derive 0.90 from its seg-v1 siblings, not be contaminated by the gate siblings' 0.10 — got ${segFused.exgMean}`);
      assert.ok(segFused.coverage !== null && Math.abs(segFused.coverage - 0.90) < 1e-6);
    } finally {
      await prisma.siteObservation.deleteMany({ where: { cycleId } });
    }
  });
});
