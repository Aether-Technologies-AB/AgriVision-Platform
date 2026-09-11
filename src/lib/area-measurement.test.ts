import { test } from "node:test";
import assert from "node:assert/strict";
import { AREA_METHOD, AREA_MODEL_SHA256, parseAreaMetadata, summarizeArea } from "./area-measurement";

function fixture() {
  const meta = {
    algorithm_version: AREA_METHOD, implementation_revision: "numpy-rf-1",
    vegetation_model_sha256: AREA_MODEL_SHA256,
    runtime_model_sha256: "f44b1798deddfe0c6b9d6154fca8cbc8d86ff68375f0ce87cdf68f2a909eb008",
    vegetation_threshold: 0.5, ownership_rule: "nearest-claimant-row-desc-channel-asc-v1",
    raw_polygon_px: 120, background_removed_px: 10, ownership_removed_px: 10,
    raw_polygon_area_cm2: 1.2, median_depth_mm: 400 as number | null, valid_depth_px: 100,
    depth_valid_pct: 100, frame_edge_distances_px: { left: 0, right: 10, top: 10, bottom: 10 },
    quality_flags: ["near_frame_edge"], presence_source: "seg-v1",
  };
  const record = { rail: "rail1", method: AREA_METHOD, is_fused: false, area_px: 100,
    area_cm2: 1 as number | null, depth_valid_pct: 100, fx: 400 };
  return { meta, record };
}

test("v2 requires consistent provenance, pixel counts and area-only scope", () => {
  const { meta, record } = fixture();
  assert.deepEqual(parseAreaMetadata(meta, record), meta);
  assert.throws(() => parseAreaMetadata(null, record));
  assert.throws(() => parseAreaMetadata({ ...meta, ownership_removed_px: 9 }, record));
  assert.throws(() => parseAreaMetadata(meta, { ...record, rail: "rail2" }));
  assert.throws(() => parseAreaMetadata(meta, { ...record, canopy_volume_cm3: 4 }));
  assert.throws(() => parseAreaMetadata(meta, { ...record, area_cm2: 3 }));
  assert.throws(() => parseAreaMetadata({ ...meta, extra: "x".repeat(4096) }, record));
  assert.equal(parseAreaMetadata(undefined, { method: "seg-v1" }), null);
});

test("insufficient depth permits pixel area but requires null physical area and flags", () => {
  const { meta, record } = fixture();
  meta.valid_depth_px = 19;
  meta.depth_valid_pct = record.depth_valid_pct = 19;
  meta.median_depth_mm = record.area_cm2 = null;
  meta.quality_flags.push("low_depth_support", "insufficient_depth");
  assert.ok(parseAreaMetadata(meta, record));
  assert.throws(() => parseAreaMetadata(meta, { ...record, area_cm2: 1 }));
  assert.throws(() => parseAreaMetadata({ ...meta, quality_flags: [] }, record));
});

test("area summary excludes review estimates and keeps edge estimates", () => {
  const base = { day: "2026-09-11", capturedAt: "2026-09-11T07:00:00Z", plantPresent: true };
  const result = summarizeArea([
    { ...base, siteId: "a", areaCm2: 100, eligible: true, qualityFlags: ["near_frame_edge"] },
    { ...base, siteId: "b", areaCm2: 140, eligible: true, qualityFlags: [] },
    { ...base, siteId: "c", areaCm2: 900, eligible: false, qualityFlags: ["low_depth_support"] },
    { ...base, siteId: "d", areaCm2: null, eligible: false, qualityFlags: ["insufficient_depth"] },
  ]);
  assert.deepEqual(result, [{ day: base.day, medianCm2: 120, includedSites: 2, reviewSites: 2 }]);
});
