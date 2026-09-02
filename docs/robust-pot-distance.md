# Making the per-pot distance measurement robust

**Intent.** Every canopy height and every canopy volume this system produces is
`plane − z`: the plant's depth subtracted from a reference distance to the
surface it grows out of. That reference is currently a single pooled scalar per
frame, shared by all four channels, and it is the root of a family of errors
that reach the traits, the presence gate, and eventually the yield calibration.
The goal of this work is one trustworthy reference distance for **every pot**,
holding in any condition, with failures that announce themselves.

Investigated 2026-09-02 against live rail1/rail2 data and the on-Pi producer
source. Nothing here is in production yet.

Companions: [`observations-pipeline-changelog.md`](observations-pipeline-changelog.md)
· [`rail-fusion-registration-fix.md`](rail-fusion-registration-fix.md)
· [`rail-pipeline-todo.md`](rail-pipeline-todo.md)
· scripts in [`rail-diagnostics/`](rail-diagnostics/)

---

## 0. How this started

The original question was not about geometry at all: **"are the ML models on
Floor 1 lettuce giving us what we want?"**

Most of the answer was yes. Detection recall matched the planted set almost
exactly — 34 sites tracked in 25–27 of 27 daytime cycles against
`plantCount = 34` — and the nadir growth curve was clean and monotonic, 6.4x
area in nine days.

**The anomaly was that the same plant measured a different size depending on how
many cameras happened to see it.**

- A paired test over **119 site-days** — same site, same day — found records
  built from 3 views reading **1.95x the volume** and 1.94x the area of records
  built from 1–2 views. Same plant. Same hour.
- On 2026-09-01, fused area averaged **35.4 cm²** against **17.2 cm²** for the
  nadir view of those same plants.
- 48% of fused records had fewer than 3 views, so the inflation was not even a
  constant — it varied run to run.

A measurement that changes with how many cameras fired is not a measurement. The
first suspicion was the fusion step, and that did turn up a real
world-registration error (~8% in the camera term, both rails). But following it
down led somewhere more basic: fused geometry is built on `plane − z`, and the
plane itself was wrong — first per stop (18 mm spread, and `merge_views` using a
cycle median anyway), then per channel (11 mm on rail1, 26.5 mm on rail2, tilted
in opposite directions). That is where the trail ended, and it is what this
document is about.

### Scope: what this does and does not affect

**`areaCm2` is NOT affected.** `area_traits` derives its scale from the median
depth of the *plant* pixels, not the channel plane — the plane is only a fallback
for blobs under 20 px. So an area-based lettuce yield model is untouched by
everything in this document, which is exactly why the Floor 1 harvest path was
put on area (Kim et al. 2024 reached R2=0.90 on butterhead lettuce from area +
perimeter, with no depth at all).

**`canopyVolumeCm3` IS affected, and it is not derived from area.** Worth stating
plainly because it is easy to assume otherwise — §7.2: *"true integral of
(plane - z) over every plant pixel x that pixel's OWN footprint. NOT area x
height."* It is an independent depth integral and carries the plane error in
full, as do `heightMmMax/Mean` and `heightProfileMm`.

**The presence gate is affected.** §7.2b's `height_mm_max >= 8 mm` test uses the
plane, so the plane helps decide whether a plant is detected at all. Measured:
the height gate really is operative on rail1 ch1 (329 `flat` rejections against
1-13 on the other channels), but rail1's ch1 error is only -2 mm and the colour
gates carry the decision elsewhere — so **Floor 1 is safe today**. Rail2's ch1 at
-27 mm against an 8 mm gate is not.

**Therefore this is not on Floor 1 lettuce's critical path right now.** It bites
on rail2/basil, where §7.7 says volume should dominate for upright plants. The
Floor 1 relevance is deferred rather than absent: §7.4 warns projected area
saturates as heads mature — *"exactly the harvest window we care about"* — and
names depth and height as the rescue, so lettuce may need volume precisely when
it matters most. Fix at a batch boundary, rail2 first.


---

## 1. What is actually wrong today

`fit_channel_plane` returns **one float per frame** — the median depth of every
non-plant pixel, all four channels pooled — and both `measure_cycle` (per view)
and `merge_views` (fused) apply it to every site in the frame. There is no
per-channel plane anywhere in the code, and `SiteObservation.channelPlaneMm` is
a single `Float`.

Four measured consequences:

**The channels are not coplanar.** Measured inside the net-pot ROIs, depth-gated
so the cardboard cannot contaminate it:

| channel | rail1 offset from pooled | rail2 offset |
| --- | --- | --- |
| ch1 | −2.0 mm | **−27.0 mm** |
| ch2 | −7.0 | −18.0 |
| ch3 | −8.0 | −12.0 |
| ch4 | −10.0 | −0.5 |
| **spread** | **11 mm** | **26.5 mm** |

Two rigs, two different tilts, in **opposite directions** — rail1 runs ch1
farthest, rail2 runs ch4 farthest. Independently mounted troughs.

**Each channel also has its own gradient along the rail.** From the frozen
reference: ch1 falls 407.5 → 403.1 mm, ch2 397.5 → 396.1, ch3 is flat at ~394,
and ch4 *rises* 393.1 → 396.0. No single scalar can represent this.

**`merge_views` is worse still** — it fits per frame and then discards it,
passing `np.median(planes)` across the whole cycle into `fuse()`. Production
per-stop planes span 18 mm (400–418 on rail1) against plants 20–35 mm tall.

**And this re-explains a master-file conclusion.** §7.2b records rail2's
empty-rig false positives as *"all ch1 … protruding a consistent 28–35 mm — one
structural thing (shelf/tent/channel lip)"*. Rail2's pooled plane is ~407 mm and
ch1's real surface ~380 mm. `407 − 380 = 27 mm`. That was not a shelf; it was
ch1's own channel surface reading as protruding against a plane belonging mostly
to the other three channels — which defeats §7.2b's 8 mm height gate by
geometry, not appearance, and no colour tuning can reach it.

---

## 2. The design that survived

**Two steps, fixed positions, arithmetic as the dictator.**

### Step 1 — calibrate once, offline

On frames where the troughs are fully visible (lit **and** empty), detect each
channel's column extent, fit a plane per `(stop, channel)`, and **freeze both**.
Averaged over several cycles, so the cross-cycle scatter becomes an honest
confidence number.

This is the same decision master file §6 already made for the site map — *"the
sites are defined once … and reused. No per-frame detection, no drift
correction"* — applied to the plane.

### Step 2 — verify at runtime, never re-derive

Each cycle the pipeline reads the frozen reference. It only has to check the
reference still holds on the pixels it predicts, and flag when it does not.

### The one change from today's data model

**The channel band is not the site map's ROI.** The ROI deliberately tiles
half-way to the neighbouring hole — correct for measuring a plant, wrong for the
plane, because it overruns the trough onto the inter-channel gap by ~17%. That
is what made ch2 read 443 mm at six stops and 398 mm at five, a 45 mm bimodality
from a band that is nominally correct. One extra frozen number per
`(stop, channel)`, stored beside the ROI.

### The fit: median-seeded, not plain and not merely trimmed

```
med    = median(z) over the band
keep   = |z − med| ≤ tol            # datum comes from the median
plane  = lstsq on keep, re-selected around the fitted plane
         but never straying > tol from med
```

Both simpler options were tried and both failed:

- **Plain least squares:** 13–24 mm residuals, tilts to −11.6°. The cardboard
  and the trough side walls drag it off the top face.
- **Trimmed-only, tight band:** fits cleanly (2–4 mm residuals) but the datum
  lands ~15 mm *near* of hand-read depth — in a narrow band the raised lip
  around each cup hole is a low-variance minority the trimming drifts onto.

The median is the estimator that matched hand-read depth, so it sets the datum;
the fit only supplies tilt, and is fenced from wandering.

---

## 3. Validation

**Ground truth by hand.** Sixteen pixel coordinates chosen by *looking* at a
gridded RGB frame — plainly white channel top face, clear of every cup and gap —
with raw depth read at each (7×7 median, all 49/49 valid). Nothing algorithmic
chose them.

> stop 6: **ch1 404.5 · ch2 397.5 · ch3 394.5 · ch4 398.5 mm**

| approach | vs hand | cells |
| --- | --- | --- |
| production pooled scalar | abs-mean **6.8 mm**, worst 13.0 | — |
| calibration (clean frames, detect once) | abs-mean 1.09 mm | 44/44 |
| **runtime (planted cycles, frozen bands)** | abs-mean **0.97 mm** | **42/44** |
| runtime with per-cycle re-detection | abs-mean 1.09 mm | 40/44 |

Frozen bands are both more accurate and higher-coverage than re-detecting, and
they delete two whole classes of failure (§4).

**Repeatability.** Cross-cycle scatter over 7 calibration cycles: mean
**0.82 mm**, worst 5.97.

**Stability over seven weeks.** Aug calibration vs Sep runtime, same frozen
bands: **41 of 42 cells within ~5 mm**. Real drift is ~2 mm on ch1/ch3.

---

## 4. Traps found before production

Each measured, not speculated. All would have shipped silently.

**Plant contamination masquerades as rig drift.** The production ExG mask leaks
leaf pixels, which sit nearer than the trough and pull the plane toward the
camera. ch2 appeared to drift 7.7 mm; under progressively heavier leaf masking:

| plant exclusion | ch1 | ch2 | ch3 | ch4 | worst |
| --- | --- | --- | --- | --- | --- |
| default | −1.68 | **−3.23** | +0.94 | −0.87 | −7.70 |
| dilate ×2 | −1.50 | −1.39 | +1.40 | −0.61 | −5.34 |
| dilate ×5 | −1.75 | **−0.12** | +1.27 | −0.48 | −3.26 |

ch2's "drift" collapses to 0.1 mm. ch1 and ch3 hold steady at every level, so
their ~2 mm is real. **Verify against a dilated mask (≥5) or the drift alarm
fires every planted cycle.**

**Residual contamination is positional.** Even at dilate 5, ch2's error grows
along the rail (−3, −4, −3, −4, −5 at higher stops) — exactly where the biggest
plants are. **A drift threshold tighter than ~5 mm will fire on canopy, not on
movement.**

**Degenerate cells pass the pixel gate.** The one cell outside 5 mm was
ch4/stop 1 at −47 mm — the same cell that reads `323.0 mm, n=0k` elsewhere. ch4
clips at the frame edge (§5.11), leaving too few usable pixels, and `MIN_PIX`
let it through. **Mark such cells unusable rather than storing a number nobody
should trust.**

**Frames must be lit — and that needs planning.** See §6.

**rail2 is entirely unvalidated.** The hand check covers rail1 stop 6 only, and
rail2's channels sit at 380–410 mm against rail1's 393–407.

---

## 5. Tried and rejected

In the spirit of §7.1, so none of this gets re-attempted.

**Runtime channel detection.** Marking a column as channel when its median depth
is within `col_tol` of the frame's global modal depth. Works on rail1 (channels
~12 mm apart, tolerance 15 mm) and **fails silently on rail2** (~30 mm apart):
`col_tol=15` finds ch1 at **1 of 11 stops** with no error; `col_tol=35` finds it
but over-detects (5 runs where 4 is correct) and degrades quality. The whole
approach existed to track drift that measures ~2 mm. Retired in favour of frozen
bands.

**Bridging plant-fragmented runs by width.** Necessary — plants blank the columns
the detector needs — but bridging by distance welds channels together: the
inter-channel gap is only ~47 px, so any bridge wide enough to span a plant also
spans the gap. It produced identical planes for ch1 and ch2. The rule that works,
if detection is ever revived: bridge on *why* a column has no answer — no usable
pixels means plant-covered and is safe to bridge at any width; usable pixels at
the wrong distance means the real gap and must never be bridged.

**Dark frames.** Proposed as the *cleanest* source, since active IR ignores the
grow lights. Measured against the lit reference: **mean −30.4 mm, worst −48.4**,
and not a uniform offset (stops 10–11 agree, the rest are 30–48 mm out), so the
detector locks onto a different surface. Dropped — we do not use dark data.

**A learned channel segmenter.** Built and validated: binary, 32 weights, pure
numpy, reproduced hand-read depth to **1.0 mm** against the pooled scalar's
6.8 mm. Kept only as an optional offline cross-check, because it cannot be more
correct than the arithmetic it was trained on, and it **failed silently** at a
threshold its own metrics called safe — 0.8% of the frame masked, zero channel
pixels in three of four channels. The arithmetic fails loudly instead, via
residual and pixel-count gates. Also worth recording: its threshold sweep was
computed on class-balanced sampled pixels and does not transfer to whole frames.

**Public plant-segmentation models.** SAM-based
([Plant-Phenotyping-SAM](https://github.com/WorasitSangjan/Plant-Phenotyping-SAM),
[SAP](https://www.biorxiv.org/content/10.64898/2026.03.11.711099v1.full)) and
lettuce-specific (MobileNetV3-PSPNet, mIoU 0.9717 at 9.3 MB, camera at 40 cm
parallel to the bed — an uncanny geometry match, but **weights not published**).
All segment plant-vs-background; **no public model knows what an NFT trough is**,
which is the half this work needs. They remain relevant to §7.5's canopy-closure
problem, not to the plane.

---

## 6. Operational requirement, easy to miss

The reference needs frames that are **lit *and* empty**, and those two almost
never coincide by accident: when Floor 1 emptied on 2026-08-22 the lights simply
went off, because there was no crop to light. The only lit-empty frames in the
entire archive are 2026-08-10 and 08-16.

**For the next batch, deliberately run one scan with the lights on while the rig
is empty** — after harvest, before transplanting. One cycle, ~5 minutes. It is
the only window in which a clean reference can be built, and if it is missed the
next batch has no reference at all. This belongs on the harvest checklist.

Related: gate on **measured frame brightness (> 150)**, never on the clock. The
photoperiod moved during the archive — hour 04 was lit on 08-10 and 08-16 but
dark by 08-24; hour 16 was lit on 08-10, dark on 08-16, lit again on 08-24.

---

## 7. What remains

1. **Step 2** — read the frozen reference at runtime, verify against a dilated
   plant mask, flag drift beyond ~5 mm, and record which source each record used.
2. **Mark degenerate cells** unusable in the reference (ch4/stop 1 today).
3. **Calibrate rail2**, and repeat the 16-point hand read there before trusting it.
4. **`merge_views`** — use the reference per view instead of `np.median(planes)`
   across the cycle.
5. **Re-check the 8 mm height gate** once planes come from the reference; it was
   set against heights biased high by 2–27 mm depending on channel and rail.
6. **Re-run the empty-rig regression** (§5.15). rail2/ch1's phantom 27 mm
   protrusion should vanish.
7. **Confirm the net-pot diameter** — still the one number that closes the
   separate 8–15% metric-scale question (see the fix spec).

---

## 8. Scripts

All in [`rail-diagnostics/`](rail-diagnostics/), all read-only against the
pipeline. Copy to the rail Pi's `agrivision/` directory (they import
`merge_views`, `measure_plants`, `gates` from there), run with the system
`python3`, and delete afterwards to leave the production tree clean.

| script | purpose |
| --- | --- |
| `build_plane_ref.py` | **Step 1.** Build/freeze the per-(stop, channel) reference. `--fixed-bands` reuses frozen bands; `--plant-dilate` tests drift vs contamination |
| `manual_vs_model.py` | Hand-read depth at 16 chosen points vs any candidate method — the ground-truth harness |
| `diff_ref.py` | Compare two references cell by cell; the drift check |
| `channel_plane_check.py` | Per-channel offsets from the pooled plane |
| `plane_check.py` | Plane tilt/gradient, and the radial-vs-perpendicular depth test |
| `geo_plane.py` | The arithmetic chain across all 11 stops |
| `train_channel.py`, `autolabel.py`, `channel_model_rail1.npz` | The learned detector — cross-check only, not in the critical path |
| `scale_check.py`, `fit_yscale.py`, `coreg_check.py` | The separate metric-scale/fusion-registration investigation |

Reference data: [`plane_ref_rail1.json`](rail-diagnostics/plane_ref_rail1.json)
— 44 `(stop, channel)` planes with frozen bands, tilts, cycle counts and scatter.
