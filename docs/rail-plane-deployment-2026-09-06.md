# Deploying the per-pot distance reference — what changed, and why

*Record of the 2026-09-06 deployment. Companion to
[`robust-pot-distance.md`](robust-pot-distance.md) (why this work exists),
[`rail-model-audit-2026-09-05.md`](rail-model-audit-2026-09-05.md) (the audit
that preceded it) and [`rail-pipeline-todo.md`](rail-pipeline-todo.md).*

**Status: LIVE on rail1 / Floor 1 as of 2026-09-06 ~17:50 UTC.** rail2 is
deliberately unchanged.

---

## 1. The one-paragraph version

Every canopy height and volume is `plane − z`. That plane used to be **one
float per frame** — the median of whatever background the canopy had not yet
covered, shared by all four channels. It is now **44 frozen numbers**, one per
`(stop, channel)`, measured offline on lit and empty frames and validated
against hand-read depth. Error against the only ground truth in this system
went from **12.25 mm to 0.89 mm**. A drift check runs every cycle so the
reference cannot go quietly stale.

`areaCm2` is unaffected and always was — it scales from plant-pixel median
depth, never the plane. What changed is `heightMmMax`, `heightMmMean`,
`heightProfileMm` and `canopyVolumeCm3`.

---

## 2. Why the pooled plane had to go

**The channels are not coplanar.** Per-`(stop, channel)` spread is 11.7 mm
mean, 14.4 worst, against a per-cell repeatability of 0.21 mm — roughly 55σ.
And the gradients run in *opposite* directions along the rail:

```
ch1: 407.5 -> 403.1   (-4.4 mm)
ch2: 397.5 -> 396.1   (-1.4)
ch3: 393.7 -> 393.9   (+0.3)
ch4: 393.1 -> 396.0   (+3.0 mm)
```

That is a twist, not a tilt. No single plane fits it, however oriented.

**And the pooled estimate degraded exactly when it mattered.** It was derived
from the background the plant had *not* covered, so early in a grow it sat on
channel top face and late it sat on gap and cardboard, which are farther.
Measured at stop 6: the plane held 402–406 mm all grow, then moved to 411 as
coverage reached 0.34. Heights inflate as the crop matures — into the harvest
window a yield calibration would be fitted on.

---

## 3. What is live

### On the rail Pi (`pi4-004`, agrivision-edge @ `b17a2eb`)

| change | effect |
| --- | --- |
| `plane_ref_rail1.json` | 44 frozen `(stop, channel)` planes with per-cell tilt |
| `measure_cycle.site_plane_mm` | per-site plane, evaluated at the blob centroid |
| `measure_cycle.verify_planes` | per-cycle drift check |
| `run_pipeline --plane-ref` | forwards the reference; **refuses to start** if configured but missing |
| `rails/rail1.json` `plane_ref` | the switch. rail2 has no such key |
| `config.py` `plane_ref_path` | resolves it, same pattern as `site_map_path` |

**The crontab was not touched.** An earlier plan added `--plane-ref` there;
that could not have worked (`run_pipeline.py` would have rejected the unknown
argument and failed every cycle) and it is the more fragile place to put
configuration — regenerating that one cron line is how `scan01` lost its depth.

### On the platform (AgriVision-Platform @ `e435587`)

Dashboard trait rollup is **nadir-only**, `MAX` across sites is replaced by
`AVG` (height) and p90 (volume band), and canopy height is plotted rather than
fetched and discarded. Floor 1 now reports 34 plants against `plantCount = 34`
and Floor 2 reports 41 against 41; previously 39–42 and 44–49.

---

## 4. Validation

**Against hand-read depth** — sixteen points chosen by eye from a gridded RGB
frame, 7×7 median, nothing algorithmic involved:

| | abs-mean | worst |
| --- | --- | --- |
| pooled scalar | **12.25 mm** | 16.5 |
| frozen reference | **0.89 mm** | 2.66 |

**The drift check has both specificity and sensitivity.** Shifted references
simulate a rig that moved:

| reference | median drift | verdict |
| --- | --- | --- |
| true, empty 2026-08-10 | −0.31 mm | quiet |
| true, planted 2026-09-05 | +0.18 mm | quiet |
| shifted +3 mm | −2.82 mm | quiet, below limit |
| shifted +8 mm | **−7.80 mm** | **fires** |

Recovery is near exact, so the reported number is the real offset.

**It judges the cycle, not the cell.** A rig that moved shifts cells
coherently; leaf contamination is scattered and positional. On 2026-09-05 ch2
ran `+1.0 +1.5 +1.9 +0.5 +0.9 −1.1 −0.9 −2.6 −2.8 −2.8 −5.5` along the rail —
tracking plant size — while the median over all cells sat at +0.18 mm.
Per-cell alarming would have cried wolf on 3 of 43 cells.

**First live cycle** (`2026-09-06_15-01-10`): 63 distinct plane values where
the pooled scalar gave 9; drift median −0.15 mm across 39 cells; 4 cells
unverifiable as the canopy closes.

---

## 5. Reading the data after this change

**`schemaVersion` is the boundary, and it means one thing.**

- `schema 2` — `channelPlaneMm` is one pooled value per frame
- `schema 3` — `channelPlaneMm` is per-site, from the frozen reference

Heights drop **~9 mm** and volumes **~41%** across that boundary. **The two
eras are not comparable.** Any trend spanning 2026-09-06 will show a step that
is a units change, not a crop event.

The bump is conditional on the reference actually being in use. A first
deployment made it unconditional, so cycle `2026-09-06_15-01-10` briefly
carried `schema 3` with pooled geometry; it was recomputed and re-pushed, and
the ingest upserted it in place (132 records, not 264 — the `NULLS NOT
DISTINCT` idempotency guard doing its job).

**Fused records are still schema 2 and still pooled.** `merge_views` computes
its own plane as `np.median(planes)` across the cycle and does not read the
reference. This is survivable *only* because the dashboard rollup is now
nadir-only — the two changes hold each other up. Do not revert one without
the other.

---

## 6. Operational

**To turn it off:** remove `plane_ref` from `rails/rail1.json`. Records revert
to the pooled plane, labelled `plane_source=pooled`, at schema 2.

**`deploy/update.sh` does not work on the rail nodes.** There is no systemd
unit and no `.venv`, so it aborts at the pip line under `set -e`. It was
written for node types that run as a service. The rails run from cron with
system python, so deploying is:

```bash
cd ~/agrivision-edge && git fetch --all && git reset --hard origin/main
```

No restart: cron spawns a fresh process each cycle. Verified safe — neither Pi
has tracked modifications, and untracked data (`cycles/`, `netlog_history.tsv`)
survives `reset --hard`.

**The harvest checklist item still stands.** A reference needs frames that are
lit **and** empty, and those almost never coincide by accident: when a floor
empties the lights go off, measured on rail2 as brightness 302–335 through the
2026-08-16 harvest, then **7 for eight straight days**. Run one scan with the
lights on while the rig is empty, after harvest and before transplanting. It
costs ~5 minutes and it is the only window in which a clean reference can be
built.

---

## 7. Things found along the way that were not the plan

**Policy belongs in the tool, not the artifact.** `build_plane_ref` writes a
fresh dict per cell, so decisions annotated onto the reference JSON were
silently destroyed by the next rebuild. `TILT_VALIDATED_RAILS`,
`NO_TILT_CHANNELS` and `UNUSABLE_CELLS` now live in the builder and are
re-applied on every rebuild. **Tilt is opt-in per rail, on evidence** — a rail
nobody has hand-read gets its `plane_mm` (the bulk of the win) and stores its
gradient as `a_fitted`/`b_fitted` while using zero. rail2 tilts the *opposite*
way to rail1, so rail1's validation says nothing about it.

**The tilt is real, but not everywhere.** The 16 hand-read points are a 2×2
grid per channel, which is what actually tests a gradient. Flat scores 1.69 mm
abs-mean, tilted 0.95 — ch1's four points span 403–409 mm inside one channel
at one stop. ch4 is the sole exception (flat 1.77 vs tilted 1.81, worst point
2.77 → 4.54), so its tilt is disabled.

**Nine "flaky" home-end cells were one shadow.** `2026-08-16_12-04-05` has
stops 9/10/11 at brightness 292/180/268 against that cycle's 413 — most
plausibly a person at the home end on harvest day. All three passed the
absolute `>150` lit gate. This matters *more* now that bands are frozen:
runtime detection used to decline to answer on a frame it could not read,
which excluded exactly these; fixed bands always answer, so they answered with
459.7 mm against a median of 397.0. `SHADOW_FRAC = 0.80` makes that gate
explicit. Home-end scatter went from **5–22 mm to 0.1–0.3 mm**, closing the
master file's standing watch item on stops 9–11.

**`np.median` had already saved us.** The stored `plane_mm` was always a
cross-cycle median, which is why a 62 mm outlier never reached the data —
`plane_mm` moved by 0.07 mm when the shadow was excluded. Cells now also carry
`mad_mm` and `max_dev_mm`. `sd_mm` is deliberately kept and deliberately not
robust: it is the only reason anyone noticed. Under MAD alone, cell `9|2`
would have reported 0.34 mm and looked like the most confident cell in the set.

---

## 8. Still open

- **`merge_views` does not read the reference.** Highest-value next step.
- **rail2 has no reference.** It can be built from archive data — contrary to
  the TODO, rail2 *does* have lit+empty frames: `2026-08-18_14`,
  `2026-08-19_12` (an off-schedule manual run) and `2026-08-21_14`, all at
  brightness 342–381 with the floor empty.
- **Stops 9–11 have never been hand-read.** They carry the largest tilts. The
  16 ground-truth points cover stop 6 only, and within it only y 150–350 of a
  480-px frame.
- **`clippedByRoi` is at 78% and is not on any dashboard.** It is the direct
  measure of whether `areaCm2` is measuring a plant or an ROI.
- **`areaCm2` has no depth-validity gate.** Area scales as depth²; one rail2
  record read 4742 cm² off 12% valid depth.
- **A schema 2→3 marker on the growth chart**, so the step reads as a units
  change rather than a crop failure.
