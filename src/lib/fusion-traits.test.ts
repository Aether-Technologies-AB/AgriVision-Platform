// Unit tests for fused colour-trait derivation. Pure functions, no database —
// unlike src/app/api/observations/route.test.ts, which is an integration test
// against the real DB.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveFusedTraits,
  indexViewsBySite,
  siblingKey,
  type ViewTraitSource,
} from "./fusion-traits";

function view(over: Partial<ViewTraitSource> = {}): ViewTraitSource {
  return {
    isFused: false,
    plantPresent: true,
    areaPx: 1000,
    coverage: 0.1,
    exgMean: 0.5,
    exgStd: 0.1,
    labAMean: -5,
    deepGreenFrac: 0.9,
    depthValidPct: 99,
    ...over,
  };
}

describe("deriveFusedTraits", () => {
  it("returns all-null when no view detected a plant", () => {
    const out = deriveFusedTraits([
      view({ plantPresent: false }),
      view({ plantPresent: false }),
    ]);
    assert.deepEqual(out, {
      coverage: null,
      exgMean: null,
      exgStd: null,
      labAMean: null,
      deepGreenFrac: null,
      depthValidPct: null,
    });
  });

  it("returns all-null for an empty input rather than zeroes", () => {
    assert.equal(deriveFusedTraits([]).exgMean, null);
  });

  it("ignores views that did not detect a plant", () => {
    const out = deriveFusedTraits([
      view({ exgMean: 0.4, areaPx: 1000 }),
      view({ exgMean: 0.9, areaPx: 1000, plantPresent: false }),
    ]);
    assert.equal(out.exgMean, 0.4);
  });

  it("ignores fused records fed in by mistake", () => {
    const out = deriveFusedTraits([
      view({ exgMean: 0.4 }),
      view({ exgMean: 0.9, isFused: true }),
    ]);
    assert.equal(out.exgMean, 0.4);
  });

  it("weights by detected area, so the bigger view dominates", () => {
    const out = deriveFusedTraits([
      view({ exgMean: 0.4, areaPx: 4000 }),
      view({ exgMean: 0.8, areaPx: 1000 }),
    ]);
    // (4000*0.4 + 1000*0.8) / 5000 = 0.48, not the unweighted 0.6
    assert.ok(Math.abs((out.exgMean as number) - 0.48) < 1e-9);
  });

  it("falls back to equal weight when areaPx is missing or zero", () => {
    const out = deriveFusedTraits([
      view({ exgMean: 0.4, areaPx: null }),
      view({ exgMean: 0.8, areaPx: 0 }),
    ]);
    assert.ok(Math.abs((out.exgMean as number) - 0.6) < 1e-9);
  });

  it("skips a null trait on one view without discarding the others", () => {
    const out = deriveFusedTraits([
      view({ coverage: null, areaPx: 1000 }),
      view({ coverage: 0.25, areaPx: 1000 }),
    ]);
    assert.equal(out.coverage, 0.25);
  });

  it("derives every colour/health trait, not just ExG", () => {
    const out = deriveFusedTraits([view()]);
    for (const [key, value] of Object.entries(out)) {
      assert.notEqual(value, null, `${key} should have been derived`);
    }
  });

  it("pools ExG variance rather than averaging the standard deviations", () => {
    // Two equal-weight views, same within-view spread, different means. The
    // canopy's real spread must exceed the per-view spread, because the views
    // disagree about the mean — averaging the stds would wrongly report 0.1.
    const out = deriveFusedTraits([
      view({ exgMean: 0.4, exgStd: 0.1, areaPx: 1000 }),
      view({ exgMean: 0.6, exgStd: 0.1, areaPx: 1000 }),
    ]);
    // grand mean 0.5; var = 0.1^2 + 0.1^2 = 0.02; sd = sqrt(0.02)
    assert.ok(Math.abs((out.exgMean as number) - 0.5) < 1e-9);
    assert.ok(Math.abs((out.exgStd as number) - Math.sqrt(0.02)) < 1e-9);
    assert.ok((out.exgStd as number) > 0.1);
  });

  it("reduces to the within-view sd when the views agree on the mean", () => {
    const out = deriveFusedTraits([
      view({ exgMean: 0.5, exgStd: 0.1 }),
      view({ exgMean: 0.5, exgStd: 0.1 }),
    ]);
    assert.ok(Math.abs((out.exgStd as number) - 0.1) < 1e-9);
  });

  it("returns a null exgStd when only some contributing views report one", () => {
    const out = deriveFusedTraits([
      view({ exgMean: 0.4, exgStd: 0.1 }),
      view({ exgMean: 0.6, exgStd: null }),
    ]);
    assert.equal(out.exgStd, null);
    assert.notEqual(out.exgMean, null, "the mean is still derivable");
  });
});

describe("indexViewsBySite", () => {
  const rec = (cycleId: string, siteId: string, over: Partial<ViewTraitSource> = {}) => ({
    ...view(over),
    cycleId,
    siteId,
  });

  it("groups per-view records by cycle and site", () => {
    const index = indexViewsBySite([
      rec("2026-09-02_11-01-10", "row06_ch2"),
      rec("2026-09-02_11-01-10", "row06_ch2"),
      rec("2026-09-02_11-01-10", "row06_ch3"),
    ]);
    assert.equal(index.get(siblingKey("2026-09-02_11-01-10", "row06_ch2"))?.length, 2);
    assert.equal(index.get(siblingKey("2026-09-02_11-01-10", "row06_ch3"))?.length, 1);
  });

  it("excludes fused records from the sibling index", () => {
    const index = indexViewsBySite([
      rec("c1", "row06_ch2"),
      rec("c1", "row06_ch2", { isFused: true }),
    ]);
    assert.equal(index.get(siblingKey("c1", "row06_ch2"))?.length, 1);
  });

  it("keeps different cycles of the same site apart", () => {
    const index = indexViewsBySite([
      rec("2026-09-02_07-01-10", "row06_ch2"),
      rec("2026-09-02_11-01-10", "row06_ch2"),
    ]);
    assert.equal(index.size, 2);
  });

  it("does not collide on ids containing underscores", () => {
    // Real ids are full of underscores ("2026-09-02_11-01-10", "row06_ch2"),
    // which is exactly why the separator is not "_".
    const a = siblingKey("2026-09-02_11-01", "10_row06_ch2");
    const b = siblingKey("2026-09-02_11-01-10", "row06_ch2");
    assert.notEqual(a, b);
  });
});
