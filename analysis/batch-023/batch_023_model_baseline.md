# Batch 023 — Floor 1 lettuce: what the models are actually giving us

*First lettuce cycle on rail1 (Floor 1, NFT, 34 plants, planted 2026-08-23).
Baseline of the trait pipeline's output, measured 2026-09-02 — day 10 of the
grow, no harvest yet. Companion to
[`../../docs/observations-pipeline-changelog.md`](../../docs/observations-pipeline-changelog.md).*

**Batch:** `B-2026-023`, `cmt685721000004jumlsrw8wr`, LEAFY_GREEN / lettuce,
ACTIVE_GROWING, `plantCount = 34`, zone `cmr83i8mv0005apc9ftndmn3n`.

---

## Verdict

**Growth tracking: yes, it works.** Detection recall is essentially perfect
against the planted set, and the daily growth curve is clean and monotonic.

**Yield estimation: no, and not started.** `freshWeightGEst` is 100% `NULL` by
design and no Floor 1 harvest has ever been recorded, so no calibration pairs
exist. Volume → grams is the commercial point of this pipeline and it is
absent. Deferred by decision until the plants are larger.

**Absolute sizes: not validated, on either rail.** The camera's pixel->mm
scale is ~8% under on rail1 and ~15% under on rail2, confirmed by two
independent tests (see the fix spec). Fused geometry compounds this into a ~2x
*inflation*. Use nadir per-view for growth — its shape over time is sound — but
treat the absolute cm2/cm3 as provisional until a tape measure settles it.

---

## Scale of the data

23,074 rail1 records, 167 cycles, `2026-07-17` → `2026-09-02`, 52 sites,
`batchId` linkage 100% (6,548/6,548 since planting). Cycles every ~4h.

A caution for anyone reading aggregate stats over all of it: **76.5% of
per-view records are `no_green`, and that is not a detection failure.** It is
dominated by (a) night cycles at 00/04/20h, when the lights are off and
detection is 0–1%, and (b) a genuinely empty floor before 2026-08-23. Scope to
daytime cycles of the current batch before judging the models.

## Detection recall — good

Over 27 daytime cycles since 2026-08-25:

- **34 sites** are solidly tracked (25–27 hits of 27), matching `plantCount =
  34` almost exactly.
- **8 sites** never fire at all — `row00_ch4`, `row01_ch4`, `row11_ch2/ch3`,
  `row12_ch1..ch4`, all at the rail ends. Genuinely empty pots.
- **~10 sites** fire sporadically (1–14 hits) at trivial volumes (0.1–3.5 cm³).
  44 sites get ≥1 hit but only 34 are planted, so these are false positives in
  empty pots. **A ~4 cm³ floor removes them.**

## Growth signal — good

Nadir per-view records (`isFused = false`, `abs(viewAngleDeg) < 5`,
`plantPresent`, daytime), daily means:

| Date | area cm² | volume cm³ | hMax mm | coverage | exgMean | deepGreenFrac |
| --- | --- | --- | --- | --- | --- | --- |
| 08-24 | 2.7 | 4.9 | 21.0 | 0.020 | 0.405 | 0.979 |
| 08-25 | 3.2 | 5.2 | 22.6 | 0.024 | 0.433 | 0.987 |
| 08-26 | 3.5 | 5.1 | 22.3 | 0.027 | 0.470 | 0.995 |
| 08-27 | 4.4 | 6.2 | 24.2 | 0.034 | 0.487 | 0.994 |
| 08-28 | 5.2 | 8.6 | 20.1 | 0.040 | 0.506 | 0.987 |
| 08-29 | 6.0 | 9.8 | 21.8 | 0.046 | 0.511 | 0.983 |
| 08-30 | 7.3 | 12.4 | 25.4 | 0.056 | 0.509 | 0.977 |
| 08-31 | 9.5 | 15.5 | 24.6 | 0.074 | 0.514 | 0.975 |
| 09-01 | 12.0 | 20.9 | 29.2 | 0.096 | 0.503 | 0.969 |
| 09-02 | 17.2 | 31.1 | 32.5 | 0.139 | 0.509 | 0.969 |

6.4x area and 6.3x volume in 9 days, monotonic, no view-count artifact. This is
what the pipeline is for and it delivers.

## Known measurement limits

**Noise ≈ one day of growth.** Within-day repeatability at `nViewsFused = 3` is
17.4% CV (worst 49.8%), against ~15–20%/day growth. A single reading cannot
separate growth from noise. Use daily means (≥2–3 readings); never alert on one
scan.

**Metric scale ~8% under (rail1), ~15% (rail2).** Two independent tests agree:
a cross-view registration fit, and a within-frame row-spacing check that uses
no rail motion at all. The rail encoder is exonerated; the camera's pixel->mm
conversion is the fault. Fused geometry compounds it into a ~2x inflation
(fused area 35.4 cm² vs 17.2 cm² nadir on 09-01). Per-view *shape over time* is
unaffected, absolute size is not. This also corroborates master file §7.3's
"we under-measure ~15%", which had been attributed to segmentation — so a
harvest calibration fitted now would bake the error into its constants. Full
diagnosis in
[`../../docs/rail-fusion-registration-fix.md`](../../docs/rail-fusion-registration-fix.md).

**`fusionGainPct` is unusable** — a ratio with a near-zero denominator, observed
to 8057%. Do not gate on it.

**Channel bias confounds cross-channel comparison.** ch1 is `clippedByRoi` in
70.5% of views and detects in only 22.3% (vs ~65% for ch2/ch3); ch4's
`depthValidPct` is 87.8% vs 98–99%. Do not compare `row05_ch1` to `row05_ch3`
as if they were equivalent instruments.

**45% of cycles are wasted.** 76 of 167 cycles run at 00/04/20h in darkness.
Gating the scan on lights-on state would cut storage and compute nearly in half
with no loss of signal.

## Watch item

`exgMean` plateaued at ~0.51 from 08-28 while biomass kept climbing, and
`deepGreenFrac` has drifted down 0.995 → 0.969 over the same window. Both are
mild and `deepGreenFrac` is still high, so this is a watch item rather than a
finding — but Floor 2 had a documented iron/Mn lockout in `batch-020`, so it is
worth a nutrient check rather than assuming index saturation.

## What would move this forward, in order

1. **Measure the physical row pitch and camera height with a tape** (two
   numbers per floor). This closes the scale question and should happen
   *before* the harvest calibration, or the calibration absorbs the error.
2. **Destructive harvest of 9–12 sites with fresh weights**, once the plants
   are large enough. This is the only thing that unlocks `freshWeightGEst`.
   Floor 2 has the precedent in
   [`../batch-020/batch_020_harvest_calibration.md`](../batch-020/batch_020_harvest_calibration.md).
3. **Use nadir per-view geometry** for all Floor 1 analysis — which is also
   what master file §7.6 prescribed for lettuce in the first place
   (`CANONICAL_GROWTH_QUERY` in `src/lib/fusion-traits.ts`).
4. **Recalibrate the metric scale** at the next batch boundary.
5. **Gate scanning on lights-on**, and add a ~4 cm³ volume floor.
6. **Fix the channel-1 ROI bounds** (master file §5.11 — known, and its
   per-channel calibration remedy is still unbuilt).
