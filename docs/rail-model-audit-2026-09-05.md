# Audit — what the trait models are actually giving us, both floors

*Independent re-derivation against the live Neon DB, 2026-09-05. Audits
[`../analysis/batch-023/batch_023_model_baseline.md`](../analysis/batch-023/batch_023_model_baseline.md)
(Floor 1 lettuce, written 2026-09-02) and extends the same treatment to Floor 2
basil, which had no equivalent baseline. Every number below was re-measured from
`SiteObservation`; nothing is carried over on trust.*

Companions: [`robust-pot-distance.md`](robust-pot-distance.md) ·
[`rail-pipeline-todo.md`](rail-pipeline-todo.md)

**Batches audited**

| | Floor 1 | Floor 2 |
| --- | --- | --- |
| rail / Pi | rail1 / pi4-004 | rail2 / pi4-005 |
| batch | `B-2026-023` lettuce | `B-2026-024` basil |
| planted | 2026-08-23 | 2026-08-25 |
| `plantCount` | 34 | 41 |

---

## 0. Verdict

The baseline's **conclusions** mostly survive. Its **evidence** frequently does
not, and two of its proposed fixes are actively wrong. One new defect is live
today and one measurement class has gone bad since the baseline was written.

| # | Claim | Status |
| --- | --- | --- |
| 1 | Detection recall matches `plantCount` | **Holds** (both floors) — but the stated evidence was wrong |
| 2 | `areaCm2` is independent of the channel plane | **Holds** — now proved from the DB, no Pi needed |
| 3 | Canopy closure threatens per-plant area | **Understated.** It is not a future risk; it is happening now |
| 4 | "8 sites never fire — `row00_ch4` … `row12_ch1..ch4`" | **Wrong.** Five of those site ids do not exist in the nadir map |
| 5 | "44 sites get ≥1 hit but only 34 planted → false positives" | **Wrong.** 37 all-time, exactly 34 since planting |
| 6 | "Add a ~4 cm³ volume floor" | **Wrong fix.** Removes 2 of 9 false positives and deletes real data |
| 7 | "45% of cycles are wasted in darkness" | **Stale.** Already fixed; 0% wasted since 09-01 |
| 8 | rail2/ch1's problem is the plane vs the 8 mm height gate | **Wrong mechanism.** Zero `flat` rejections; it is ROI clipping → `pale` |
| 9 | batch-020's `h_max` → weight signal (r = +0.85) | **Does not survive.** r = −0.008 on the DB's own cycles |
| — | `areaCm2` has no depth-validity gate | **New defect, live** |

---

## 1. Detection recall — the conclusion holds, the evidence did not

The baseline said: *"Over 27 daytime cycles since 2026-08-25: **34 sites** are
solidly tracked (25–27 hits of 27)."*

Over that window (30 lit cycles, 08-25 → 09-02) the real distribution is:

| hits of 30 | sites |
| --- | --- |
| 25–26 | 7 |
| 20–24 | 20 |
| 9–17 | 7 |
| 0 | 10 |

Only **7** sites reach 25+, not 34. The median site had 23. The reason is
visible in the per-cycle counts: detection was *ramping*, not flat — 11–17 sites
detected on 08-25/26, reaching 34 only around 09-01. Early cycles missed
plants because they were 3 cm², not because recall was imperfect.

**Re-measured on 09-01 → 09-05 (19 lit cycles), where size is no longer the
limiter, the claim becomes true:**

| rail | sites at ≥18/19 (rail2: /20) | sites firing at all | `plantCount` |
| --- | --- | --- | --- |
| rail1 | 32 | **34** | **34** |
| rail2 | 32 | **41** | **41** |

Both floors match `plantCount` exactly at the site level. That is a genuinely
good result — and worth one caveat the baseline did not state: `plantCount` is a
number the grower typed, so an exact match is strong corroboration, not proof of
per-pot correctness.

### Survivorship bias — I expected it, and it is not there

If early cycles only detect the biggest plants, early daily means are biased up
and the growth multiple is understated. Tested by re-running the daily mean over
a **fixed cohort** (the sites detected on 08-25) against all-detected:

| day | area, all detected | area, fixed cohort |
| --- | --- | --- |
| 08-25 | 3.01 | 3.01 |
| 08-31 | 9.53 | 9.69 |
| 09-05 | 43.98 | 45.18 |

~3% apart throughout. The hypothesis fails; the baseline's growth curve is
robust to it. Recorded so it does not get re-attempted.

---

## 2. The site-map claims are wrong in a way that matters

The baseline lists *"8 sites never fire at all — `row00_ch4`, `row01_ch4`,
`row11_ch2/ch3`, `row12_ch1..ch4`, all at the rail ends. Genuinely empty pots."*

**`row00_*` and `row12_*` are not in the nadir map at all.** They appear only in
the oblique views (−19.3° and +16.7°), in all 180 cycles, and detect 0–2 times
ever. They are the site map overshooting the rail ends — pots visible only from
an angled stop. Calling them "genuinely empty pots" mixes them with real
never-detecting nadir sites.

The nadir map is **44 sites (row01–row11 × ch1–ch4), constant across all 180
cycles on rail1 and all 129 on rail2.** The 52 in the all-views count is
44 nadir + 8 oblique-only.

The sites that actually never fire in the nadir map:

| rail | count | sites |
| --- | --- | --- |
| rail1 | **10** | `row01_ch1` `row01_ch4` `row02_ch1` `row03_ch1` `row09_ch1` `row10_ch1` `row11_ch1..ch4` |
| rail2 | **3** | `row10_ch1` `row11_ch2` `row11_ch3` |

### The false-positive claim, and why the proposed fix is wrong

The baseline: *"44 sites get ≥1 hit but only 34 are planted, so these are false
positives. **A ~4 cm³ floor removes them.**"*

Measured on rail1 nadir:

| window | sites with ≥1 detection |
| --- | --- |
| all time | 37 |
| since planting (08-23) | **34** |
| empty-floor era (before 08-23) | 9 |

There is no population of 10 sporadically-firing false positives inside the
batch. The 9 empty-floor false positives are **9 records total across five
weeks**, at these volumes:

```
2.6  3.4  4.2  4.2  4.9  5.1  5.5  5.5  8.8   cm³
```

**A 4 cm³ floor removes 2 of 9.** Worse, the batch's own plants averaged
4.6–6.2 cm³ on 08-25 → 08-27, so that floor would have deleted three days of
real early-growth data to remove two bad records. The floor should not be
built as specified.

---

## 3. `areaCm2` is plane-independent — now proved from the DB

`robust-pot-distance.md` §0 asserts this from the producer source
(`area_traits` scales from plant-pixel median depth, not the channel plane).
It can be proved without Pi access, because the plane is constant within a
frame.

First, confirm the pooling claim at the right granularity — **a frame is one
stop, not one cycle**:

| rail | frames (cycle, stop) | with exactly one distinct `channelPlaneMm` |
| --- | --- | --- |
| rail1 | 1980 | **1980** |
| rail2 | 1419 | **1419** |

One scalar per frame, shared by all four channels. Confirmed. (Grouping by
*cycle* instead shows up to 11 distinct values — that is the 11 stops, not a
contradiction.)

Now the test: within one frame the plane is a single constant, so if `areaCm2`
scaled from the plane, the implied px→area scale would be identical across all
four channels. It is not:

```
rail1, cycle 2026-09-04_11-01-10, stop 5 — channelPlaneMm = 405 for all four
  row05_ch1   49.8 cm²  12361 px   scale 40.29
  row05_ch2   14.4 cm²   3773 px   scale 38.17
  row05_ch3   22.0 cm²   5845 px   scale 37.64
  row05_ch4   32.7 cm²   8541 px   scale 38.29
```

Mean within-frame scale spread is **17.1% (rail1) / 20.1% (rail2)**; it would be
exactly 0 if the plane drove it. **`areaCm2` is plane-independent — confirmed.**

---

## 4. NEW DEFECT — `areaCm2` has no depth-validity gate

Area does not depend on the *plane*, but it does depend on **plant-pixel
depth**, and that dependency is unguarded. Area scales as depth², so a bad depth
read blows up quadratically.

```
rail2, cycle 2026-09-05_14-06-10, site row07_ch4
  areaCm2 = 4742.5        areaPx = 8386        depthValidPct = 12
  → implied scale 144x the rail median
  canopyVolumeCm3 = 7.33  heightMmMax = 54     (internally inconsistent)
```

That single record moved the rail-wide daily mean for its cycle from a median of
**24.6 cm² to a mean of 144 cm²**.

Scope, measured across the whole archive (nadir, detected, `areaPx > 0`):

| rail | records | scale > 2× rail median | share |
| --- | --- | --- | --- |
| rail1 | 1164 | **0** | 0% |
| rail2 | 3399 | **9** | 0.26% |

All nine are on **rail2 / ch4**. `depthValidPct` predicts the worst of them
(mean implied scale 75.1 for `depthValidPct < 50` vs 32.6 for ≥ 80), though not
all — several sit at 97–100% "valid" depth that is nonetheless locked onto the
wrong surface.

**Consequences.** Rare but high-impact: 0.26% of records, one of which more
than doubled a rail-day mean. Floor 1 is clean — no blowups on rail1, so the
lettuce area series is not contaminated. **Fixes:** gate `areaCm2` on
`depthValidPct`, and use medians rather than means for any rail-level
aggregate.

---

## 5. Canopy closure is not a future risk — it is happening now

The baseline flagged §7.5's warning that per-plant area becomes ill-defined at
closure. Three days later the direct per-record evidence for it — `clippedByRoi`
— has gone from near-zero to dominant on both rails:

| day | rail1 clipped % | rail1 area cm² | rail1 CV | rail2 clipped % | rail2 median area |
| --- | --- | --- | --- | --- | --- |
| 08-27 | 0.0 | 4.4 | 0.42 | 7.6 | 4.3 |
| 08-31 | 0.0 | 9.5 | 0.60 | 12.3 | 10.4 |
| 09-01 | 4.6 | 12.0 | 0.56 | 18.1 | 10.4 |
| 09-02 | 13.4 | 17.5 | 0.47 | 28.1 | 13.1 |
| 09-03 | 27.1 | 24.8 | 0.44 | 38.9 | 18.1 |
| 09-04 | 64.2 | 32.3 | 0.40 | 58.1 | 21.3 |
| 09-05 | **77.8** | 44.0 | **0.30** | **75.8** | 28.8 |

`clippedByRoi` is the pipeline's own flag for "this plant hit the edge of its
ROI". When it is true, `areaCm2` is truncated at the ROI boundary — it stops
measuring the plant and starts measuring the ROI. **78% of Floor 1's nadir
records are now clipped.**

The collapsing CV corroborates it: 0.60 → 0.30 while plants grow. Falling
variance during rapid growth is not the crop becoming uniform, it is every plant
converging on the same ROI ceiling.

Coverage compounding also accelerated past the baseline's ~26%/day — the last
four days ran 1.46×, 1.43×, 1.32×, 1.35× (≈35–45%/day).

**This is the most consequential finding in this audit.** `areaCm2` is Floor 1's
entire yield path, and it is saturating right now. A harvest calibration fitted
on post-09-03 area will be fitted on ROI geometry, not plants. `clippedByRoi`
should be the gate, and it needs a dashboard line today — not `coverage`, which
is a lagging proxy for the same thing.

---

## 6. Floor 2 — rail2/ch1, and the mechanism is not the plane

`robust-pot-distance.md` §1 and master file §7.2b attribute rail2/ch1's
behaviour to the 27 mm plane error defeating the 8 mm height gate. On the live
planted batch that is not what is happening.

Planted sites only, 09-01 → 09-05, nadir:

| rail | ch | n | detected | `flat` | `pale` | `clippedByRoi` |
| --- | --- | --- | --- | --- | --- | --- |
| rail1 | 1 | 95 | **98.9%** | 0 | 1 | 24% |
| rail1 | 2 | 190 | 100% | 0 | 0 | 27% |
| rail1 | 3 | 190 | 100% | 0 | 0 | 29% |
| rail1 | 4 | 171 | 91.2% | 2 | 0 | 60% |
| rail2 | 1 | 200 | **66.0%** | **0** | **68** | **100%** |
| rail2 | 2 | 200 | 98.5% | 0 | 0 | 34% |
| rail2 | 3 | 200 | 99.5% | 0 | 1 | 37% |
| rail2 | 4 | 220 | 98.6% | 0 | 2 | 28% |

**rail2/ch1 is `clippedByRoi` in 200 of 200 views**, and every one of its 68
losses is `pale` — a colour rejection. **Zero `flat` rejections.** The height
gate the plane work is aimed at is not rejecting anything on rail2/ch1 today.
The mechanism is: the ROI is clipped, so only a sliver of the pot is in frame,
so `deepGreenFrac` falls under the 0.25 gate.

This does not invalidate the plane work — the 27 mm error is real, measured, and
still corrupts ch1's recorded heights and volumes. But **fixing the plane will
not recover rail2/ch1's missing 34% of detections.** The ch1 ROI bounds
(TODO P3) are the blocker there, and they are a bigger lever on rail2 than the
plane is.

**Related correction:** the baseline's *"ch1 … detects in only 22.3% of views vs
~65% for ch2/ch3"* pools planted and empty pots. On rail1's *planted* ch1 sites
the detection rate is 98.9%. The 22.3% is mostly the six unplanted ch1 sites
correctly not detecting.

---

## 7. Floor 2 — the batch-020 harvest calibration does not survive

This is Floor 2's only model-vs-reality check, so it matters.
[`batch_020_harvest_calibration.md`](../analysis/batch-020/batch_020_harvest_calibration.md)
reports, from cycle `2026-08-16_12-39-56`: volume vs weight r = −0.47 (n=7, not
significant), `h_max` vs weight **r = +0.85, R² 0.72, significant**.

**That cycle does not exist in the database.** rail2's cycles on 2026-08-16 are
`06-06-10`, `10-06-10`, `14-06-10`, `18-06-10`. The first two are pre-harvest;
the last two are post-harvest and all-null (plants cut at 14:48). The doc's
numbers must come from an on-Pi `traits.jsonl` for a manual scan that was never
ingested — so the calibration cannot be verified through the platform at all.

Re-fitting the **same seven sites and the same nine fresh weights** against the
DB's own pre-harvest cycle (`10-06-10`, four hours earlier):

| predictor | doc's value | DB `10-06-10` |
| --- | --- | --- |
| `canopyVolumeCm3` | r = −0.468 | r = **+0.038** |
| `heightMmMax` | r = **+0.851** *(significant)* | r = **−0.008** |
| `areaCm2` | — | r = −0.417 |

My code reproduces the doc's own numbers to three decimals (−0.468 vs −0.47,
0.851 vs 0.85), so the divergence is in the data, not the arithmetic.

**The height signal vanishes completely.** The doc's leave-one-out caveat —
"collapses to r = 0.46 when the tallest plant is removed" — was directionally
right but understated the problem. It is not one influential plant; it is that
the underlying trait values are unstable at the four-hour scale:

```
row02_ch2  volume  344.09 (06:06)  ->  621.78 (10:06)   +81% in 4h
row10_ch2  volume   39.18 (06:06)  ->    2.02 (10:06)   -95%, depthValidPct 8.5 -> 1.0
```

All seven sites were `clippedByRoi = true` at harvest.

**Also resolved:** the doc's open item #3 — *"`row09_ch3` (23.8 g) and
`row10_ch2` (18.9 g) have no matching site in §7 … I need the full
`traits.jsonl` to pair them"* — is answerable now. Both sites exist in the DB
with traits, but the values are degenerate (`row09_ch3`: 3.5 cm³, 11 mm for a
23.8 g plant; `row10_ch2`: `depthValidPct` 1.0). They were not missing, they
were broken. Note the pattern that the weighing sheet's `row09_ch3`/`row10_ch2`
sit exactly one row above §7's `row08_ch3`/`row09_ch2` — **a −1 row offset
between the harvest sheet and the site map is worth ruling out before any
future calibration**, because if it is real it mispairs every row.

**Bottom line: there is no usable volume→grams or height→grams law from
batch-020.** Floor 2 is in the same position as Floor 1 on yield: nothing
calibrated.

---

## 8. Corrections to smaller claims

**"45% of cycles are wasted" — already fixed.** Since 09-01 both rails run four
cycles per day, all lit:

| rail | scan hours (UTC-as-stored) | zero-detection cycles since 09-01 |
| --- | --- | --- |
| rail1 | 07, 11, 15, 19 | **0 of 19** |
| rail2 | 06, 10, 14, 18 | **0 of 20** |

Before 09-01, rail1 wasted 10 of 36 post-planting cycles (27.8%) at 00/04/20h;
rail2 wasted none. TODO P3's "gate scanning on lights-on" is done in practice —
close it.

**Within-day repeatability, re-measured (nadir, 09-01 → 09-05):**

| trait | rail1 mean CV | rail2 mean CV |
| --- | --- | --- |
| `areaCm2` | 0.358 | 0.364 |
| `canopyVolumeCm3` | 0.395 | 0.361 |
| `heightMmMax` | **0.122** | **0.076** |

The baseline's 17.4% figure was for *fused* records at `nViewsFused = 3`, so this
is a different population and not a contradiction. But it is worth stating that
**`heightMmMax` is by far the most repeatable nadir trait** — 3–5× better than
area or volume. Guidance that leans on area for stability has it backwards.
(Caveat: part of the 36% is real intraday growth at current rates.)

**`channelPlaneMm` spread has widened.** The plane doc cites 18 mm across stops
(400–418, rail1). Measured 09-01 → 09-05: rail1 **399–437**, rail2 **396–440**.
Consistent with TRAP 1 — canopy contamination pulling the pooled plane nearer as
plants grow — and a reminder that the pooled plane degrades as the canopy closes.

---

## 9. What this changes

1. **Put `clippedByRoi` on a dashboard today.** It is at 78%/76% and it is the
   direct measure of area validity. Do not wait for `coverage`.
2. **Do not fit a harvest calibration on post-09-02 area.** The window where
   Floor 1 area is trustworthy is closing or closed. If harvest calibration is
   still wanted this cycle, it needs `clippedByRoi = false` records only, and
   there may not be enough of them.
3. **Gate `areaCm2` on `depthValidPct`**, and switch rail-level aggregates from
   mean to median.
4. **Re-scope the rail2/ch1 work.** The ch1 ROI bounds, not the plane, are what
   is costing 34% of ch1's detections.
5. **Drop the 4 cm³ volume floor** as specified. Nine bad records over five
   weeks do not justify a threshold that sits inside the batch's own early
   growth range.
6. **Close TODO P3's lights-on item** — already true.
7. **Treat batch-020's calibration as withdrawn**, and rule out the −1 row
   offset before the next harvest session.

## 10. What I could not check

- **`area_traits` source.** §3's proof is empirical (within-frame scale spread),
  not a source read. The producer lives on the Pis and I did not SSH.
- **Which pots are physically planted.** Recall matching `plantCount` is strong
  corroboration, not ground truth.
- **rail2's plane reference** — still unbuilt and unvalidated (TRAP 5 stands).
- **Whether the 09-05 rail2 area blowup recurs.** One record; watch it.
