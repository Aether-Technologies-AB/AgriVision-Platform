# Camera-rail pipeline — TODO

> **Updated 2026-09-06.** The plane work shipped to rail1; see
> [`rail-plane-deployment-2026-09-06.md`](rail-plane-deployment-2026-09-06.md).
> Items below are marked done where they are done, and corrected where
> measurement contradicted them. rail2 is deliberately unchanged.

Consolidated from the 2026-09-02 investigation of Floor 1 lettuce model output.
Evidence for every claim is in
[`observations-pipeline-changelog.md`](observations-pipeline-changelog.md) and
[`rail-fusion-registration-fix.md`](rail-fusion-registration-fix.md);
diagnostics in [`rail-diagnostics/`](rail-diagnostics/).

Ordering is by consequence, not by effort.

---

## P0 — none

*An earlier revision of this file claimed a closing window here: capture the
per-(stop, channel) plane calibration before canopy closure. **That was wrong**
and has been removed. The reasoning conflated "this measurement needs an open
canopy" with "this measurement must be made now" — but the captures are
archived, so the open-canopy moment is already recorded.*

*Checked 2026-09-02 on pi4-004: **184 of 202 cycles retain their depth `.npy`**,
back to 2026-07-20. Floor 1 sat **empty** from then until planting on 2026-08-23,
so roughly a month of genuinely bare-rig cycles with depth intact is on disk
(e.g. `cycles/2026-08-22_12-04-05`, 11 `.npy`). That is a better calibration
source than any in-canopy estimate would have been. The plane calibration is
therefore **untimed** — compute it whenever height is actually needed, and see
P2.*

*One real loss, already realised: `~/agrivision/scan01` — the empty-rig
regression scan (§5.15) — has **0 `.npy`, 22 `.jpg`**. Its depth was pruned at
some point. The scan still works as an RGB/segmentation regression test, but no
depth or plane check can be run against it. The August empty-floor cycles
supersede it, so nothing is blocked.*

## P1 — before any harvest calibration is fitted

- [ ] **Tape-measure the row pitch, both floors.** Centre of row 1 to centre of
  row 11, divided by 10 (~±1 mm effective on a ~131 mm quantity). Camera height
  is a secondary cross-check only — too imprecise to be the reference.
  - Unblocks the 8–15% metric-scale question, which is currently circular:
    §4.1's 13.08 cm pitch was derived from the anchor hunt *using* 1024
    steps/cm.
  - **Not** a blocker for Floor 1 area-only yield: Kim et al. 2024 reached
    R²=0.90 in dimensionless pixel units, so a constant scale error is absorbed
    by a fit on your own rail. It *is* required before transferring a law
    between rails (they differ 6%), using the Wageningen constants (§7.3), or
    comparing absolute cm² across floors.

- [ ] **Decide: add a `perimeter` trait?** Kim et al.'s best hand-built model is
  area + perimeter (3rd-degree polynomial, R²=0.90) on butterhead lettuce at a
  near-identical rig. We record area, width, length (≈MA/MI), coverage — no
  perimeter. A few lines off the existing cv2 contours, but needs a
  `SiteObservation` column, so it is a schema decision.

- [ ] **Run `src/app/api/observations/route.test.ts` before deploying the ingest
  change.** It is the fused-idempotency guard, and it writes rows + an API key
  to the production Neon DB — deliberately left unrun.

---

## P2 — producer fixes, at a batch boundary

Prioritise **rail2/basil**: its per-channel spread is 26.5 mm against an 8 mm
presence gate, and §7.7 says volume should dominate for upright plants.

Floor 1 remains lower risk, but for a narrower reason than stated earlier: its
height gate is only decisive on ch1 (329 `flat` rejections vs 1–13 elsewhere),
and — crucially — a plane error cannot manufacture false positives while the
*colour* gates reject bare channel first, which the detection data confirms
(34 tracked sites matching `plantCount`, 8 sites never firing). What a plane
error *does* corrupt on Floor 1 is the recorded height and volume values
themselves. Since Floor 1's yield path is area-only, that is tolerable for now —
but see the unresolved datum question below before trusting any absolute
height.

### The plan: two steps, arithmetic as the dictator, FIXED positions

Settled 2026-09-02: **no runtime detection.** Channel extents are determined
once on clean frames and frozen, exactly as master file 6 does for the site
map. Validated against hand-read depth at stop 6:

| | vs hand | cells |
| --- | --- | --- |
| calibration (clean lit+empty, detect once) | abs-mean 1.09 mm | 44/44 |
| **runtime (planted cycles, frozen bands)** | abs-mean **0.97 mm** | **42/44** |

Frozen bands are both MORE accurate and higher-coverage than re-detecting per
cycle (which managed 40/44 at abs-mean 1.09), and they delete two whole classes
of failure. The one change needed versus today: the channel band is NOT the
site map's ROI. The ROI deliberately tiles half-way to the neighbouring hole,
which is right for measuring a plant but overruns the trough onto the gap by
~17% — the cause of ch2 reading 443 mm at six stops and 398 mm at five.

No ML in the critical path. The learned detector reproduced hand-read depth to
1.0 mm, but it was trained on labels the arithmetic produced, so it cannot be
more correct than the arithmetic by construction — and it failed silently at a
threshold its own balanced-sample metrics called safe. The arithmetic fails
loudly instead (residual and pixel-count gates). Keep the model, if at all, as
an optional offline cross-check: a disagreement means something changed.

- [x] **STEP 1 — build the per-(stop, channel) distance reference, offline.**
  `build_plane_ref.py` -> `plane_ref_rail1.json` (44 planes). Built from 7 lit,
  empty cycles (2026-08-10 and 08-16), where the troughs are fully visible.

  | | result |
  | --- | --- |
  | channel runs detected per frame | median **4** (4 is correct) |
  | cross-cycle scatter | mean **0.82 mm**, worst 5.97 |
  | vs hand-read depth, stop 6 | abs-mean **1.09 mm**, worst 2.27 |

  Hand vs reference: ch1 404.5/406.3, ch2 397.5/**397.6**, ch3 394.5/**394.6**,
  ch4 398.5/396.2. The two middle channels are essentially exact; the two edge
  channels — the ones with known ROI-clipping and depth-dropout problems — are
  ~2 mm out.

  **Each channel has its own gradient, in different directions:** along the
  rail ch1 falls 407.5 -> 403.1 mm, ch2 397.5 -> 396.1, ch3 is flat at ~394,
  and ch4 *rises* 393.1 -> 396.0. Independently mounted troughs. A single
  pooled scalar cannot represent this, which is the whole defect in one table.

  Watch item: ch3/ch4 show sd 5-6 mm at stops 9-11 (home end) where every other
  cell is 0.1-0.3 mm. Worth a look before trusting those four cells.

### Traps found before production (verified against data, 2026-09-02)

Each of these was measured, not speculated. All three would have shipped
silently.

- **TRAP 1 — plant contamination masquerades as rig drift.** The production ExG
  mask leaks leaf pixels, which sit nearer than the trough and pull the fitted
  plane toward the camera. Comparing the Aug reference against Sep cycles showed
  ch2 apparently drifting **7.7 mm**. Re-running with the plant mask dilated:

  | plant exclusion | ch1 | ch2 | ch3 | ch4 | worst |
  | --- | --- | --- | --- | --- | --- |
  | default | -1.68 | **-3.23** | +0.94 | -0.87 | -7.70 |
  | dilate x2 | -1.50 | -1.39 | +1.40 | -0.61 | -5.34 |
  | dilate x5 | -1.75 | **-0.12** | +1.27 | -0.48 | -3.26 |

  ch2's "drift" collapses to 0.1 mm — it was never drift. ch1 (-1.7) and ch3
  (+1.3) hold steady at every level, so those ~2 mm ARE real.
  **Consequence: Step 2 must verify against a dilated plant mask (>=5), or it
  will cry drift on every planted cycle.** And a drift alarm threshold tighter
  than ~3 mm will false-alarm.

- **TRAP 2 (withdrawn as a design, kept as a guard) — dark frames.** I had
  proposed using unlit cycles as the cleanest reference source, on the grounds
  that active IR ignores the grow lights. Measured against the lit reference
  they are **mean -30.4 mm out, worst -48.4 mm**, and not by a uniform offset
  (stops 10-11 agree, the rest are 30-48 mm out), so the detector locks onto a
  different surface in the dark. The idea is dropped — **we do not use dark
  data.**

  The guard still matters, because nothing else enforces it: the cron scans on
  a fixed schedule and roughly 45% of cycles are unlit, so anything that
  reaches for "the latest cycle" can silently grab one. Gate reference building
  and verification on measured frame brightness (>150), never on the clock —
  the photoperiod moved during the archive.

  **Operational consequence, and it needs planning:** the reference requires
  frames that are LIT *and* EMPTY, and those two rarely coincide by accident —
  when Floor 1 was empty from 2026-08-22 the lights were simply off, because
  there was no crop to light. The only lit-empty frames in the whole archive are
  2026-08-10 and 08-16. **So for the next batch, deliberately run one scan with
  the lights on while the rig is empty** — after harvest, before transplanting.
  It costs one cycle (~5 minutes) and it is the only moment a clean reference
  can be built.

- **TRAPS 3 and 4 — RETIRED, along with the runtime detection that caused
  them.** They were: a rig-dependent `col_tol` that silently found rail2's ch1
  at only 1 of 11 stops, and unguarded over-detection of 5 runs where 4 is the
  only correct answer. Both existed *solely* because the channel extents were
  being re-detected every cycle. They vanish with frozen bands, and the
  simplification is the right call on the measurements: drift over seven weeks
  was ~2 mm, which never justified detecting per cycle. Master file 6 had
  already made this decision for the site map — "the sites are defined once ...
  and reused. No per-frame detection, no drift correction" — and it applies
  equally here.

- **TRAP 6 — degenerate cells pass the pixel gate.** With frozen bands, 41 of
  42 cells agreed to within ~5 mm between the Aug calibration and Sep runtime.
  The one exception was ch4/stop 1 at **-47 mm**, the same cell that reads
  `323.0 mm, n=0k` elsewhere: ch4 clips at the frame edge (5.11), leaving too
  few usable pixels, and `MIN_PIX` let it through anyway. Mark such cells
  unusable in the reference rather than storing a number nobody should trust.

- **TRAP 7 — residual leaf contamination survives dilation, and it is
  positional.** Even at plant-dilate 5, ch2's diffs worsen along the rail
  (-3, -4, -3, -4, -5 at the higher stops) — exactly where the biggest plants
  are. So a drift alarm set tighter than ~5 mm will fire on canopy, not on
  movement.

- **TRAP 5 — rail2's reference is entirely unvalidated.** The hand-read check
  covers rail1 stop 6 only. Do the same 16-point manual read on rail2 before
  trusting anything there; its channels sit at very different distances
  (380-410 vs rail1's 393-407).

- [x] **STEP 2 — use the reference at runtime.** DONE, live on rail1
  2026-09-06 (`agrivision-edge` 3afedb1). Drift check validated in both
  directions: quiet on true references (−0.31 mm empty, +0.18 planted), fires
  on a simulated 8 mm move (−7.80). It judges the CYCLE, not the cell —
  per-cell alarming would have fired on 3 of 43 cells purely from canopy.
  Original text: Per cycle the pipeline reads
  `plane_ref_rail1.json` rather than re-deriving geometry from a
  canopy-occluded frame. It only has to *verify*: sample the channel pixels the
  reference predicts, check the median agrees within tolerance, and flag or
  update on drift. Record which source each record used.

  Doing both steps at once is what kept failing, and both failure modes are
  worth remembering: a strict per-cycle detector lost 13 of 44 fits at only
  ~15% canopy coverage, and a loose one bridged the ~47 px inter-channel gap
  and welded ch1 and ch2 into a single run, reporting one distance for both.
  Neither happens on a clean frame, which is exactly why Step 1 is offline.

- [ ] **Bridging rule to preserve.** Channel columns get chopped up by whatever
  sits on the trough, so short breaks must be bridged — but never by width
  alone, since any bridge wide enough to span a plant also spans the gap. Bridge
  on the REASON a column has no answer: no usable pixels means unknown
  (plant/cup) and is safe to bridge at any width; usable pixels at the wrong
  distance means known gap and must never be bridged.

- [ ] **Repeat Step 1 for rail2** — opposite tilt, its own reference. **Not
  blocked on a new capture**, contrary to the note above: rail2 has three
  lit+empty cycles in the archive (`2026-08-18_14`, `2026-08-19_12` — an
  off-schedule manual run — and `2026-08-21_14`, brightness 342–381 with the
  floor empty). The 16-point hand read is still required before its tilt is
  trusted; until then `TILT_VALIDATED_RAILS` gives it flat planes.
- [x] **`merge_views`: use the reference** — DONE 2026-09-06. It was worse than
  written here: not "per view" but ONE scalar for the entire cycle, applied to
  every site at every stop. Nadir and fused planes now agree for 34 of 34
  sites. Fused volumes ×0.585 median; 36 → 34 records, the two dropped being
  `row00_ch2`/`row00_ch3`, which have no nadir cell at all.
- [x] **Re-check the 8 mm height gate** — MEASURED 2026-09-06: applying the
  reference drops 5 of 664 present records (0.8%) below the gate on rail1.
  Detection is essentially unaffected; no retune needed for now.
- [ ] **Re-run the empty-rig regression** (section 5.15) afterwards.
- [ ] **Fusion registration** (`y_scale` + tilt). Lowest priority: 7.6 says use
  nadir for lettuce anyway, so this is basil-only work.

## Optional: the learned channel detector (NOT in the critical path)

- [ ] **Auto-label a channel-vs-background segmenter from the empty-floor
  archive.** The hard part of the plane work is not distance — geometry solves
  that exactly — it is deciding *which pixels are channel*. That is currently a
  hand-tuned `exg > 0.14 AND brightness > 120` threshold, and 5.14 is the
  record of how brittle it is: adding black cups silently invalidated the colour
  tuning for 40 hours.
  - 7.2b already names the fix: *"The robust long-term answer is a learned
    segmenter (U-Net) ... but it needs labeled data, which needs a grow."*
  - **The labels are already free.** Floor 1 sat empty 2026-07-20 -> 08-23 with
    depth retained: ~1 month of cycles where every pixel is known
    non-plant, plus a fixed site map giving cup and channel positions. That is
    thousands of auto-labeled frames, no human annotation.
  - Division of labour: **ML for perception** (nonlinear, learnable, labels
    free) and **geometry for measurement** (exact, needs no training).

## P3 — known, lower impact

- [x] **Make depth retention safe by default.** DONE — merged to `main`
  2026-09-06 (`agrivision-edge` c93bbb7). `--prune-days` now defaults to 0 and
  is ignored entirely. Until that merge it existed ONLY as an unpushed local
  commit on each Pi, which `update.sh`'s `git reset --hard origin/main` would
  have destroyed. Original text: Right now the *only* thing
  preserving depth is `--prune-days 0` in one cron line; `run_pipeline.py`'s
  own default is `14`. Anyone who runs the pipeline by hand, or any regeneration
  of that crontab entry, silently destroys depth older than two weeks — which is
  how `scan01` already lost its depth. Change the default to 0 (or drop the
  prune step) so the safe behaviour is the unconfigured one. Disk is not the
  constraint: 43% used, ~50 MB/day, ~20 months of headroom.
- [x] **Gate scanning on lights-on.** ALREADY TRUE as of 2026-09-01 — the cron
  moved to 07/11/15/19 (rail1) and 06/10/14/18 (rail2), and **0 of 39 cycles
  since then are unlit**. The "76 of 167" figure spans the empty-floor era and
  no longer describes the rig.
- [ ] ~~**Add a ~4 cm³ volume floor.**~~ **DO NOT BUILD AS SPECIFIED.** Re-measured
  2026-09-05: only 37 sites ever fire, and exactly 34 since planting. The false
  positives are **9 records across five weeks**, at 2.6/3.4/4.2/4.2/4.9/5.1/
  5.5/5.5/8.8 cm³ — a 4 cm³ floor removes 2 of 9 and would have deleted three
  days of real early growth (the batch averaged 4.6–6.2 cm³ on 08-25→27).
- [ ] **Fix the ch1 ROI bounds**, or implement §5.11's per-channel calibration.
  ch1 is `clippedByRoi` 70.5% of views vs ~31% elsewhere, and detects in 22.3%
  vs ~65%. Cross-channel absolute comparison is confounded until then.
- [ ] **Drop or clamp `fusionGainPct`.** Legitimate definition, unusable in
  practice: near-zero denominator, observed to 8057%.
- [ ] **Put `depthValidPct` on a dashboard.** Kim et al.'s RealSense D405 was
  destroyed by humidity in three weeks. Ours (D435, a different unit §5.6 had
  already chosen for other reasons) shows no decline over ~7 weeks — rail1
  98.4→94.6, rail2 94.7→92.9, fluctuating not collapsing, and recent dips track
  rising canopy. Progressive collapse is the signature to watch for.

---

## P4 — master-file corrections

The **hardware** master file is now in the repo at
[`reference/AgriVision_Camera_Rail_Master_File.md`](reference/AgriVision_Camera_Rail_Master_File.md),
with a verified staleness header (6 stops vs the real 11, "no cron installed"
vs a cron that runs the pipeline, depth glare "54–77% valid" vs 91.8% measured).
Credentials in it were redacted before committing.

**But that is not the file these § references point at.** `§4.1`, `§5.11`,
`§5.14`, `§5.15`, `§6`, `§7.2`–`§7.7`, `§8`, `§9`, `§10` belong to a LATER
revision that adds numbered sections 6–10 (site maps, the vision pipeline,
tooling inventory, open items, operational gotchas). **That revision is still
not in the repo, so every § reference below and throughout these docs is
dangling.** Getting it committed is worth more than any single correction in
it.

The corrections below apply to that missing revision, and remain open:

- [ ] **§7.6 + open item "Multi-view fusion not implemented".** It is
  implemented and running on *both* rails since ~2026-07-18, with
  `site_map_railN_mv.json` in place. The section still says every record carries
  `view_angle_deg: 0.0` and to "skip it for lettuce". Its *reasoning* remains
  correct and is why nadir is the right read for Floor 1.
- [ ] **§7.2b's rail2/ch1 attribution.** "A consistent 28–35 mm protrusion —
  one structural thing (shelf/tent/channel lip)" is almost certainly the plane
  bias: rail2's pooled plane is ~407 mm, ch1's real surface ~380 mm, difference
  27 mm, IQR 2.0 mm over 33 sites × 11 stops. A spirit level settles it.
- [ ] **§7.2's hemisphere validation** ("height 97%, volume 83%") should note it
  cannot exercise the plane estimate — a synthetic hemisphere sits on a known
  flat plane. That is why 97% accuracy coexisted with a 27 mm plane error.
- [ ] **§8 tooling inventory** says the pipeline lives on pop-os. The live
  producer is on the rail Pis (`pi4-004`/`pi4-005`,
  `~/agrivision-edge/nodes/pilot-basement/piN-rail/agrivision/`). pop-os holds
  a copy last touched 2026-07-17 and runs nothing.

---

## Blocked on plants

- [ ] **Harvest calibration** — §7.4's protocol. 9–12 sites per session, fresh
  weights, spanning a size range, **recording the channel** per §5.11's
  per-channel fit. Deferred by decision until the plants are larger
  (2026-09-02). This is the only thing that unlocks `freshWeightGEst`, which is
  100% NULL and forced null server-side.
  - Watch for area saturation: §7.4 warns projected area stops growing while
    weight climbs "exactly [in] the harvest window we care about". If that
    happens, height/volume is the rescue — which is why P0 matters even though
    Floor 1 is area-only today.

---

## Done, 2026-09-02

- [x] **Fused records get colour/health traits at ingest** — `coverage`,
  `exgMean`, `exgStd`, `labAMean`, `deepGreenFrac`, `depthValidPct`, derived as
  `areaPx`-weighted means of sibling per-view records (`exgStd` pooled, not
  averaged). `src/lib/fusion-traits.ts` + `route.ts`. 15 unit tests pass; not
  yet deployed, and the integration test above is unrun.
- [x] **Canonical Floor 1 growth query** reading nadir per-view rather than
  fused geometry — `CANONICAL_GROWTH_QUERY`.
- [x] **Closed §7.2b's seedling caveat.** It warned the 0.25 `deep_green_frac`
  gate was validated on mature lettuce (0.924), not seedlings. Measured on
  B-2026-023: **0.979–0.995**, above the mature reference and ~4× the gate. The
  gate is safe for seedlings; the `pale(…<0.25)` rejections are empty pots. This
  also supplies §9's missing positive control (cups + plants).
