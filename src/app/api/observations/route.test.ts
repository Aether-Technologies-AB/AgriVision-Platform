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
});
