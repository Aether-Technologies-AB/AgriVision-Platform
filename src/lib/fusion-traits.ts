// Fused-record trait derivation for the Pilot Basement camera-rail pipeline
// (SiteObservation), plus the canonical analysis gates for rail trait data.
//
// Everything asserted here was measured against live rail1 (Floor 1, lettuce)
// data and read out of the producer source on 2026-09-02. The numbers and the
// method live in docs/observations-pipeline-changelog.md; the producer-side
// fix is specified in docs/rail-fusion-registration-fix.md.
//
// ─── The producer, in one paragraph ─────────────────────────────────────────
//
// The rail Pi (pi4-004 for rail1, pi4-005 for rail2) runs, per cycle:
// scan_cycle -> measure_cycle -> merge_views -> push_traits. `measure_cycle`
// emits one PER-VIEW record per (site, rail stop) with traits computed in the
// CAMERA frame. `merge_views` then deprojects all three views of a pot into a
// shared WORLD frame using the rail encoder position, rasterises a max-height
// map, and emits one FUSED record. So per-view and fused traits come from two
// independent passes with independently applied gates.
//
// ─── Why this file exists (1): fused rows carry no colour traits ────────────
//
// Confirmed in merge_views.py: the fused record it writes is
//     {rail, cycle_id, site_id, view_angle_deg:"fused", is_primary_view,
//      n_views_fused, channel_plane_mm, nadir_volume_cm3, fusion_gain_pct,
//      schema, **pot_meta, **r}
// where `pot_meta` is only {channel, global_row} and `r` is only fused
// GEOMETRY (volume/area/height/profile/cells). There is no coverage, exgMean,
// exgStd, labAMean, deepGreenFrac or depthValidPct anywhere in it — matching
// the database, where those columns were 0% populated across all 1,030
// existing rail1 fused rows.
//
// That matters because exgMean and deepGreenFrac are the greenness/paling
// signals — the early warning for the iron/Mn lockout that already bit
// Floor 2 (see analysis/batch-020/). The row with the best geometry could not
// answer "is this plant yellowing?", so every consumer had to hand-join the
// fused row back to its per-view siblings and average them. This module does
// that once, at ingest, from the siblings that arrive in the same POST.
//
// ─── Why this file exists (2): fused GEOMETRY is currently inflated ─────────
//
// The fusion algorithm itself is sound in design — max height per world cell
// (an occluded view under-reports, so the tallest observation is the
// best-informed one), with camera poses read off the rail encoder rather than
// estimated. It does NOT double-count by construction.
//
// But on rail1 the three views do not actually land on top of each other.
// Measured on cycle 2026-09-02_11-04-08 (31 pots with 3 views):
//   - cell overlap ratio (fused cells / summed per-view cells) = 0.80 mean,
//     where perfectly stacked 3-view pots would give ~0.33 and fully disjoint
//     views give 1.0.
//   - the same pot's world-Y drifts -0.65 mm per degree of view angle
//     (n=62, sd 1.00), i.e. ~23 mm across the +-18deg span. Linear in VIEW
//     ANGLE, not in rail position, so the rail-translation term is fine and
//     the camera-frame Y correction is mis-scaled by ~8%.
//   - fitting one scalar y_scale gives 1.082 (+8.2%), which cuts cross-view
//     scatter from 14.3 mm to 11.8 mm sd — real, but only part of it;
//     residual tilt/distortion remains.
//
// Consequence: fused areaCm2 / canopyVolumeCm3 are inflated roughly 2x (on
// 2026-09-01, fused area averaged 35.4 cm2 against 17.2 cm2 for the nadir
// view of the same plants) and the inflation scales with how many views were
// merged. That is exactly why a paired same-site same-day test found 3-view
// records reading 1.95x the volume of 1-2-view records OF THE SAME PLANT.
//
// This is NOT corrected here. Rescaling ingested measurements would be
// guessing at the producer's geometry and would corrupt the raw record. It is
// fixed by calibrating the rail, and until then fused geometry must be gated
// (see below) or avoided in favour of per-view geometry, which never touches
// the world transform and is clean.

/** A per-view record's fields this module reads. Structural, so both the
 *  route's ParsedRecord and a plain test fixture satisfy it. */
export type ViewTraitSource = {
  isFused: boolean;
  /** "gate" (production ExG/ROI) or "seg-v1" (segmentation model). A fused row
   *  must only ever be filled from siblings measured the SAME way. */
  method: string;
  plantPresent: boolean;
  areaPx: number | null;
  coverage: number | null;
  exgMean: number | null;
  exgStd: number | null;
  labAMean: number | null;
  deepGreenFrac: number | null;
  depthValidPct: number | null;
};

/** Colour/health traits derivable from per-view records by area-weighted mean.
 *  exgStd is handled separately (pooled, not averaged) — see deriveFusedTraits. */
export const DERIVABLE_MEAN_TRAITS = [
  "coverage",
  "exgMean",
  "labAMean",
  "deepGreenFrac",
  "depthValidPct",
] as const;

export type DerivableMeanTrait = (typeof DERIVABLE_MEAN_TRAITS)[number];

export type DerivedFusedTraits = {
  coverage: number | null;
  exgMean: number | null;
  exgStd: number | null;
  labAMean: number | null;
  deepGreenFrac: number | null;
  depthValidPct: number | null;
};

/** Group key for matching a fused record to its per-view siblings. Uses a NUL
 *  byte, which cannot occur in any of the ids — unlike "|" or "_", both of which
 *  appear inside real cycleIds ("2026-09-02_11-01-10") and siteIds
 *  ("row06_ch2").
 *
 *  `method` is part of the key. Since 2026-09-09 one cycle can be measured
 *  twice — by the production ExG/ROI gate and by the segmentation model — and
 *  the two produce different masks over the same plant. Keying without it lets
 *  a `gate` per-view sibling silently fill a `seg-v1` fused row's colour
 *  traits, which would read as a model measurement while being a gate one. */
export function siblingKey(cycleId: string, siteId: string, method: string): string {
  return `${cycleId}\u0000${siteId}\u0000${method}`;
}

/** Index the non-fused records of one POST by (cycleId, siteId) so each fused
 *  record can find the views it was built from. push_traits sends a whole
 *  cycle in one call (~167 records for rail1), so the siblings are reliably
 *  in-batch; when they are not, derivation yields nulls and invents nothing. */
export function indexViewsBySite<T extends ViewTraitSource & { cycleId: string; siteId: string }>(
  records: T[]
): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const rec of records) {
    if (rec.isFused) continue;
    const key = siblingKey(rec.cycleId, rec.siteId, rec.method);
    const bucket = index.get(key);
    if (bucket) bucket.push(rec);
    else index.set(key, [rec]);
  }
  return index;
}

/**
 * Area-weighted colour/health traits for a fused record, from the per-view
 * records that actually detected a plant.
 *
 * Weighted by `areaPx`, not equal-weighted: these are all per-view spatial
 * averages over detected pixels, so a view that saw 4,000 leaf pixels must
 * count for more than one that caught 200 pixels of leaf edge. A view with a
 * null/zero areaPx falls back to weight 1 rather than being dropped, so a
 * producer that omits areaPx still yields a plain mean instead of nothing.
 *
 * Note this deliberately keys off the per-view records' own `plantPresent`,
 * which comes from `measure_cycle`'s gates — NOT from `n_views_fused`, which
 * counts views passing `merge_views`' independent (pre-height) gates. The two
 * legitimately disagree: merge_views applies its protrusion gate only after
 * fusing, precisely because fusion can reveal height that every single view
 * missed to occlusion. A fused row can therefore have no colour traits
 * derivable even though it fused three views, and that is correct behaviour
 * rather than a fault to paper over.
 *
 * `exgStd` is POOLED, not averaged. Averaging per-view standard deviations
 * understates the whole canopy's spread by discarding the between-view
 * differences in mean. Pooled variance keeps both terms:
 *     var = sum(w_i * (s_i^2 + (m_i - M)^2)) / sum(w_i)
 * where M is the area-weighted grand mean of exgMean. It is computed only
 * when every contributing view supplies both exgMean and exgStd; a partial
 * set yields null rather than a half-pooled number.
 *
 * Returns all-null when no view detected a plant — callers must not read that
 * as zero.
 *
 * This function does NOT filter by `method` — it averages exactly the views it
 * is handed. Keeping the methods apart is the caller's job, and is done by
 * `siblingKey`, which includes the method in the group key.
 */
export function deriveFusedTraits(views: ViewTraitSource[]): DerivedFusedTraits {
  const contributing = views.filter((v) => !v.isFused && v.plantPresent);

  const empty: DerivedFusedTraits = {
    coverage: null,
    exgMean: null,
    exgStd: null,
    labAMean: null,
    deepGreenFrac: null,
    depthValidPct: null,
  };
  if (contributing.length === 0) return empty;

  const weightOf = (v: ViewTraitSource): number =>
    v.areaPx !== null && Number.isFinite(v.areaPx) && v.areaPx > 0 ? v.areaPx : 1;

  const weightedMean = (trait: DerivableMeanTrait): number | null => {
    let num = 0;
    let den = 0;
    for (const v of contributing) {
      const value = v[trait];
      if (value === null || !Number.isFinite(value)) continue;
      const w = weightOf(v);
      num += w * value;
      den += w;
    }
    return den > 0 ? num / den : null;
  };

  const result: DerivedFusedTraits = { ...empty };
  for (const trait of DERIVABLE_MEAN_TRAITS) {
    result[trait] = weightedMean(trait);
  }

  const pooled = contributing.filter(
    (v) =>
      v.exgMean !== null &&
      Number.isFinite(v.exgMean) &&
      v.exgStd !== null &&
      Number.isFinite(v.exgStd)
  );
  if (pooled.length === contributing.length && result.exgMean !== null) {
    const grandMean = result.exgMean;
    let num = 0;
    let den = 0;
    for (const v of pooled) {
      const w = weightOf(v);
      const deviation = (v.exgMean as number) - grandMean;
      num += w * ((v.exgStd as number) ** 2 + deviation ** 2);
      den += w;
    }
    result.exgStd = den > 0 ? Math.sqrt(num / den) : null;
  }

  return result;
}

// ─── Canonical analysis gates ───────────────────────────────────────────────

/**
 * The growth query to use for leafy-green rails TODAY.
 *
 * It reads the NADIR PER-VIEW record, not the fused record, because per-view
 * traits are computed in the camera frame and so are untouched by the world-
 * registration error that currently inflates fused geometry ~2x. For lettuce
 * this costs almost nothing: a rosette viewed from above hides little from
 * the nadir camera, which is the whole reason fusion was built for upright
 * basil in the first place.
 *
 * Verified clean on rail1 batch B-2026-023 (planted 2026-08-23, 34 plants):
 * area 2.7 -> 17.2 cm2 and volume 4.9 -> 31.1 cm3 over 2026-08-24..09-01,
 * monotonic, with no view-count artifact.
 *
 * Two other corrections are baked in:
 *  - Daily MEAN per site, not single readings. Within-day repeatability is
 *    17.4% CV (worst 49.8%) while the plants grow ~15-20%/day, so one reading
 *    cannot separate growth from noise; the daily mean can.
 *  - Unlit cycles excluded — but by `plantPresent`, NOT by the clock. An
 *    earlier version of this query filtered `extract(hour) BETWEEN 6 AND 19`.
 *    That is wrong: the photoperiod MOVED during the archive. Measured frame
 *    brightness shows hour 04 lit on 2026-08-10 and 08-16 but dark by 08-24,
 *    and hour 16 lit on 08-10, dark on 08-16, lit again on 08-24. Any fixed
 *    hour window therefore drops real lit cycles and admits dark ones.
 *    `plantPresent = true` already excludes dark frames, since an unlit frame
 *    detects nothing (0-1% of views) — so the hour filter added no protection
 *    and only introduced a wrong assumption.
 *
 *    The 76.5% `no_green` rate over all of rail1 history is mostly unlit
 *    cycles plus a genuinely empty floor before 2026-08-23 — not a detection
 *    failure.
 */
export const CANONICAL_GROWTH_QUERY = `
SELECT "siteId",
       "capturedAt"::date     AS day,
       count(*)               AS readings,
       avg("areaCm2")         AS area_cm2,
       avg("canopyVolumeCm3") AS volume_cm3,
       avg("heightMmMax")     AS height_mm_max,
       avg("coverage")        AS coverage,
       avg("exgMean")         AS exg_mean,
       avg("deepGreenFrac")   AS deep_green_frac
FROM "SiteObservation"
WHERE "rail" = $1
  AND "method" = 'gate'
  AND "isFused" = false
  AND "plantPresent" = true
  AND abs("viewAngleDeg") < 5
GROUP BY 1, 2
HAVING count(*) >= 2
ORDER BY 1, 2;
`.trim();

/**
 * If you must use fused geometry before the rail is recalibrated, gate on a
 * fixed view count. Fused volume scales with how many views were merged
 * (1.95x from 1-2 views to 3), so mixing view counts makes a plant look like
 * it shrank overnight when one rail stop simply missed it. Fixing
 * nViewsFused = 3 makes the inflation a constant instead of a variable — the
 * series is then usable for RELATIVE growth, still not for absolute size.
 *
 * Do NOT gate on `fusionGainPct`. Its definition is legitimate —
 * 100*(fused_volume - nadir_volume)/nadir_volume, i.e. how much volume fusion
 * recovered over the single nadir view — but it is unusable in practice: it
 * is a ratio with a near-zero denominator, running to 8057% when the nadir
 * view caught a sliver of leaf, and it is inflated by the same registration
 * error it would be used to detect.
 */
export const FUSED_GEOMETRY_GATE = `"isFused" = true AND "nViewsFused" = 3`;
