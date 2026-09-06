# Camera-rail trait pipeline — changelog

**Read this before comparing `SiteObservation` data across dates.**

Trait values are produced by a measurement pipeline that changes over time. A
step change in a trait's level is therefore not always biology — it can be a
pipeline change. This file is the record of those changes, so a future analysis
can tell the two apart. Every entry states **what changed**, **when**, and
**what it does to comparability**.

Order: newest first. Dates are UTC.

Related:

- [`observations-endpoint.md`](observations-endpoint.md) — the ingest contract.
- [`rail-fusion-registration-fix.md`](rail-fusion-registration-fix.md) — the
  open producer-side fix for fused geometry.
- [`../analysis/batch-023/batch_023_model_baseline.md`](../analysis/batch-023/batch_023_model_baseline.md)
  — the Floor 1 model-output baseline these findings came from.

---

## 2026-09-02 — Fused records get colour/health traits, derived at ingest

**Change.** `POST /api/observations` now fills the colour/health traits on
FUSED records from the per-view records that arrive in the same request:
`coverage`, `exgMean`, `exgStd`, `labAMean`, `deepGreenFrac`, `depthValidPct`.
Code: [`src/lib/fusion-traits.ts`](../src/lib/fusion-traits.ts), wired into
[`src/app/api/observations/route.ts`](../src/app/api/observations/route.ts).

**Why.** `merge_views.py` on the rail Pi writes fused records containing
geometry only. Its record is
`{rail, cycle_id, site_id, view_angle_deg:"fused", is_primary_view,
n_views_fused, channel_plane_mm, nadir_volume_cm3, fusion_gain_pct, schema,
**pot_meta, **r}`, where `pot_meta` is only `{channel, global_row}` and `r` is
only fused geometry. Confirmed against the database: those six columns were
**0% populated across all 1,030 pre-existing rail1 fused rows**, while
per-view rows had them at 19.9%. `exgMean` and `deepGreenFrac` are the
greenness/paling signals — the early warning for the iron/Mn lockout that hit
Floor 2 (see `analysis/batch-020/`) — so the row carrying the best geometry
could not answer "is this plant yellowing?".

**Method.** Area-weighted (`areaPx`) mean over sibling per-view records with
`plantPresent = true`. `exgStd` is *pooled*, not averaged, so the canopy's
spread includes the between-view disagreement in mean. Fill-only: a
producer-sent value always wins, so this silently stops applying if
`merge_views` ever emits these itself.

**Comparability.**

- Fused rows for cycles **on or after 2026-09-02** have these six traits.
  Earlier fused rows have `NULL`, and are **not** backfilled — so `NULL` vs
  non-`NULL` on a fused row is itself the provenance marker for this change.
- The values are area-weighted view means, **not** measurements of the 3D
  reconstruction. They are directly comparable to per-view colour traits of
  the same cycle, and to each other over time. Do not treat them as a
  different, better instrument than the per-view values — they are a summary
  of exactly those values.
- **No per-view value changed.** No geometry value changed on any row.
- A fused row can still have `NULL` colour traits after this change, when no
  sibling view reported `plantPresent`. That is correct and expected — see the
  two-pass gating note below.

---

## Open, not yet fixed: metric scale is ~8-15% under on BOTH rails

**Not a change — a standing defect.** Recorded here because it silently
affects every trait built on a pixel->mm conversion, per-view and fused alike.

`merge_views.py`'s design is sound: max canopy height per world cell (an
occluded view under-reports, never over-reports, so the tallest observation is
the best-informed), with camera poses read off the rail encoder rather than
estimated. It does not double-count by construction.

But the views **do not land on top of each other**, on either rail. Two
independent tests, on live cycles from both:

| | Cross-view fit (uses rail motion) | Within-frame row spacing (**no** rail motion) | Overlap ratio | Yw scatter |
| --- | --- | --- | --- | --- |
| rail1 | 1.082 | **1.082** (mean 0.925, n=20) | 0.804 | 14.3 mm sd |
| rail2 | 1.156 | **1.149** (mean 0.871, n=22) | 0.767 | 24.5 mm sd |

The within-frame test measures the separation of two pot rows visible in a
single image, so it never touches the encoder — and it reproduces the
cross-view scalar to within 0.6% on both rails. That **exonerates the rail step
scale and localises the fault to the camera's pixel->mm conversion.**

The two cameras also disagree with each other about a physical distance: for a
row pitch `rails/rail2.json` calls "the same channels as rail1", rail1's camera
measures 121.0 mm and rail2's 113.9 mm. `fx` differs only 619.3 vs 616.9
(0.4%), nowhere near enough to explain 6%.

**Effect on the data.** Fused footprint and volume are inflated roughly 2x, and
the inflation grows with how many views were merged. (Absolute per-view sizes
are affected too, in the opposite direction — see the correction below.)

- On 2026-09-01, fused area averaged **35.4 cm²** against **17.2 cm²** for the
  nadir view of the same plants — a 2.06x ratio.
- A paired same-site same-day test over 119 site-days found 3-view records
  reading **1.95x** the volume and 1.94x the area of 1–2-view records *of the
  same plant on the same day*.
- 48% of fused records (433 of 900 since 2026-08-25) have `nViewsFused < 3`.

**What to do until it is fixed.**

- Prefer **per-view nadir** geometry (`isFused = false AND abs(viewAngleDeg) <
  5`). Per-view traits never touch the world transform, so they carry no
  view-count artifact and their *shape over time* is trustworthy. Their
  absolute cm2/cm3 still inherit the scale error. For lettuce this costs little — a
  rosette hides little from an overhead camera; fusion was built for upright
  basil. `CANONICAL_GROWTH_QUERY` in `src/lib/fusion-traits.ts` does this.
- If you must use fused geometry, gate `nViewsFused = 3` so the inflation is a
  constant rather than a variable. Usable for *relative* growth, never for
  absolute size.
- **Do not gate on `fusionGainPct`.** Its definition is legitimate —
  `100*(fused_volume − nadir_volume)/nadir_volume` — but it is a ratio with a
  near-zero denominator, reaching **8057%** when the nadir view caught a sliver
  of leaf, and it is inflated by the very registration error it would be used
  to detect.

**Corrected 2026-09-02 (second pass), after reading the master file and
testing both rails.** The first version of this entry blamed a rail1-specific
registration slip. That was wrong on two counts:

- **rail2 is worse, not exempt** (overlap 0.767 vs 0.804; Yw scatter 24.5 vs
  14.3 mm sd; fitted scalar 1.156 vs 1.082).
- **The rail step scale is exonerated.** A within-frame test measuring the
  spacing of two pot rows visible in one image — using no rail motion at all —
  independently reproduces the same scalar (rail1 1.082 vs 1.082; rail2 1.149
  vs 1.156). The fault is the camera's pixel->mm scale.

Consequence: this is **not confined to fused rows**. Every trait built on
pixel->mm is affected, per-view included — `areaCm2` (scales as the square),
`canopyVolumeCm3`, `widthMm`, `lengthMm`. Fusion is only where it becomes
visible. The nadir per-view series remains the best available *relative* growth
signal (its shape is unaffected by a constant scale error), but its absolute
cm2/cm3 values are not validated.

This corroborates master file §7.3's own "we under-measure ~15%" note, which
was attributed to ExG segmentation on Wageningen's cluttered scenes. The same
magnitude appears in the rig's own geometry, where segmentation plays no part —
so a large share of that 15% may be scale, not segmentation. Any harvest
calibration fitted before this is fixed will bake the error into its constants.

**Blocked on one physical measurement:** the assumed 13.08 cm row pitch is not
independent — it was derived from the anchor hunt using 1024 steps/cm, so pitch
and step scale are circular. A tape measure of the true row pitch and camera
height, per floor, closes it.

Fix spec: [`rail-fusion-registration-fix.md`](rail-fusion-registration-fix.md).
Recommended timing: **at a batch boundary**, not mid-batch — it will produce a
step change in fused geometry, and splitting a batch's series across the change
makes that batch harder to analyse than leaving it consistently wrong.

---

## Doc drift: the master file predates multi-view fusion

Master file §7.6 and open item "Multi-view fusion not implemented" state that
fusion is **not built**, that "every record says view_angle_deg: 0.0", and
explicitly: *"Only worth building for basil; skip for lettuce."* That is stale
as of its 2026-08-07 revision — `merge_views.py` is implemented and running on
**both** rails, multi-view site maps exist (`site_map_railN_mv.json`), and
rail1 (lettuce) has been emitting fused records since 2026-07-18.

This matters for interpretation, not just tidiness: §7.6's reasoning — *"Lettuce
(flat rosette): nadir is best, neighbours are redundant -> take the primary
view"* — is still sound, and is exactly why the recommended Floor 1 query reads
the nadir per-view record. Using nadir for lettuce is the **documented original
design**, not a workaround invented to dodge the scale bug.

## Standing behaviour worth knowing (not defects)

These have been true from the start. They are listed because each one has
already been mistaken for a bug.

**Two-pass gating: `nViewsFused` and per-view `plantPresent` legitimately
disagree.** `measure_cycle.py` decides `plant_present` per view with its own
gates; `merge_views.py` independently decides which views to fuse with its
own, and applies its protrusion/height gate **after** fusing — deliberately,
because "fusing can reveal height that every single view missed to occlusion".
So a fused row can report a plant that no single per-view row did. In the
existing rail1 data that is 76 fused rows with zero detecting views, plus ~100
claiming more views than there were detections. This is by design; do not
"fix" it by reconciling the counts.

**Night cycles detect nothing.** Cycles run every ~4h including 00/04/20h,
when the lights are off. Those cycles yield 0–1% detections. 76 of 167 rail1
cycles are dark. Any analysis must filter by hour (`BETWEEN 6 AND 19`) or it
will average real plants with empty frames.

**The historical `no_green` rate is not a detection failure.** 76.5% of all
rail1 per-view records are `no_green`, but that is dominated by dark cycles
plus a genuinely empty floor before B-2026-023 was planted on 2026-08-23. In
daytime cycles of the current batch, ~34 of 52 sites are detected in 25–27 of
27 cycles — matching `plantCount = 34` almost exactly.

**`freshWeightGEst` is always `NULL`.** Forced null server-side; no
calibration exists because no Floor 1 harvest has ever been recorded. Volume →
grams needs a destructive harvest paired with a scan. Deferred until the plants
are larger (decision, 2026-09-02).

**Channel 1 is ROI-clipped, channel 4 loses depth.** On rail1 day cycles,
ch1 views are `clippedByRoi` 70.5% of the time (vs ~31% for ch2/ch3) and
detect a plant in only 22.3% of views (vs ~65%); ch4's `depthValidPct`
averages 87.8% against 98–99% elsewhere. Cross-channel comparison of absolute
size is therefore confounded — do not compare `row05_ch1` against
`row05_ch3` without accounting for it.
