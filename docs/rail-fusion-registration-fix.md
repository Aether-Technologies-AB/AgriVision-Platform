# Rail geometry: three defects in the pixel->mm and plane model (open)

**Status:** diagnosed to the camera term; needs one physical measurement to close.
**Diagnosed:** 2026-09-02, both rails, live cycles.
**Supersedes:** the first version of this file, which framed it as a rail1-only
fusion-registration bug. It is neither rail1-only nor confined to fusion.

> **This is not just a fused-record problem.** The error is in the pixel→mm
> scale, which every trait is built on — `areaCm2`, `canopyVolumeCm3`,
> `widthMm`, `lengthMm`, per-view **and** fused. Fusion is only where it
> becomes *visible*, because misregistration is a symptom you can see.

## Where the code lives

Not on `pop-os` (stale copy, newest file 2026-07-17, nothing running). Live
producer is on the rail Pis:

```
pi4-004 (rail1, Floor 1, lettuce)  ~/agrivision-edge/nodes/pilot-basement/pi4-004-rail/agrivision/
pi4-005 (rail2, Floor 2, basil)    ~/agrivision-edge/nodes/pilot-basement/pi4-005-rail/agrivision/
```

SSH as the node's own user (`ssh pi4-004@pi4-004`). Chain per cycle:
`scan_cycle` → `measure_cycle` → `merge_views` → `push_traits` → `push_photo`.

## What was measured

`merge_views.deproject()` maps pixels to a shared world frame:

```python
Y  = (v - cy) * z / fy
Yw = direction * (MM_PER_STEP * P) - direction * Y     # P = encoder steps
```

Two **independent** tests, on both rails:

1. **Cross-view fit** (`fit_yscale.py`) — fit the single scalar on `Y` that
   makes a pot's three views agree on `Yw`. Uses rail motion.
2. **Within-frame row spacing** (`scale_check.py`) — measure the camera-frame
   separation of two pot rows *visible in the same image*, compare against the
   assumed 130.8 mm row pitch. Uses **no rail motion at all**.

| | Cross-view fit | Within-frame | Overlap ratio | Yw scatter |
| --- | --- | --- | --- | --- |
| rail1 | 1.082 | **1.082** (mean 0.925, n=20, sd 0.161) | 0.804 | 14.3 mm sd |
| rail2 | 1.156 | **1.149** (mean 0.871, n=22, sd 0.160) | 0.767 | 24.5 mm sd |

The two methods agree to within 0.6% on both rails. Since the within-frame test
never touches the encoder, **the rail step scale is exonerated and the camera
term is the fault**. My earlier "rail1 is misregistered" framing was wrong:
rail2 is worse, and both are wrong in the same direction.

### The two rails disagree with each other

`rails/rail2.json` states the true row pitch is "~13.08 cm (same channels as
rail1)". Yet the two cameras measure that same physical pitch as:

- rail1: 130.8 × 0.925 = **121.0 mm**
- rail2: 130.8 × 0.871 = **113.9 mm**

Two cameras, nominally identical channel geometry, 6% apart. At least one is
wrong regardless of what the true pitch is. `fx` differs only 619.3 vs 616.9
(0.4%) — nowhere near enough.

### This corroborates something already in the master file

§7.3 records that the Wageningen scale check "plateaus at 0.64… Ratio ~0.85,
i.e. **we under-measure ~15%**", and attributes it to ExG segmentation failing
on their cluttered scenes. My measurements find the same magnitude of
under-measurement **in the rig's own geometry**, where segmentation is not
involved at all (§7.2: "our masks are visibly near-perfect").

So a large part of that ~15% may be **metric scale, not segmentation**. That
matters directly for §7.3/§7.4: a scale error inflates the fitted intercept and
biases the slope, and it is the one error a harvest refit will *silently
absorb* rather than reveal.

## Second, separate defect: `merge_views` uses one plane for the whole cycle

Found 2026-09-02 while testing the height question. **Independent of the scale
error above, and cheaper to fix.**

`measure_cycle.py` fits the channel plane **per frame** (line ~180,
`plane = fit_channel_plane(depth_mm, mask)` inside the per-stop loop). Correct.

`merge_views.py` fits per frame too, then throws it away:

```python
planes.append(plane)                                   # per frame
plane_mm = float(np.median(planes)) if planes else None  # ONE for the cycle
r = fuse(views, plane_mm, args.cell_mm)                # used for every view
```

But the plane is **not constant along the rail.** Production per-stop values,
rail1 cycle `2026-09-02_11-04-08` (straight from `pipeline.log`):

```
stop    1    2    3    4    5    6    7    8    9   10   11
plane 407  410  418  407  403  403  404  401  407  405  400   (mm)
```

18 mm of spread against a cycle median of ~405. Heights are `plane_mm - z`, and
these plants are **20–35 mm tall** — so at stop 3 (true plane 418, median 405)
canopy height is under-read by ~13 mm, i.e. **40–60% of the plant**. Volume
integrates height, so it inherits this directly.

Whether the gradient is the NFT channels' designed flow slope (~1.7% on rail1
would be ~1:57, within normal NFT practice — and the master file's §1 "laid out
flat and coplanar" may simply not hold for a working NFT bed), rail sag, or
carriage tilt, does not change the fix.

**Fix:** carry each view's own plane through fusion — compute height per view at
deprojection time and rasterise heights, rather than passing one `plane_mm`
into `fuse()` and subtracting there. This is a contained change to
`deproject()`/`fuse()` and needs no calibration.

**Note this is a third independent reason to prefer per-view for lettuce:** the
per-view path already gets the plane right.

## Third defect, and the largest: the four channels are not coplanar

Found 2026-09-02, prompted by the right question: *does the camera-to-channel
distance differ between ch1..ch4?* It does, on both rails, and **nothing in the
pipeline or the data model can represent it.**

`fit_channel_plane` returns ONE float per frame — the median depth of every
non-plant pixel, all four channels pooled. `measure_cycle` (per-view) and
`merge_views` (fused) both use that single number for every site in the frame,
whatever channel it sits in. `SiteObservation.channelPlaneMm` is likewise a
single `Float`. There is no per-channel plane anywhere, on any floor.

Measured inside the net-pot ROIs only (non-plant pixels, depth gated to
300-500 mm so the cardboard backing and near noise cannot contaminate it):

| channel | rail1 offset from pooled | IQR | rail2 offset from pooled | IQR |
| --- | --- | --- | --- | --- |
| ch1 | -2.0 mm | 5.0 | **-27.0 mm** | 2.0 |
| ch2 | -7.0 mm | 8.0 | -18.0 mm | 6.0 |
| ch3 | -8.0 mm | 5.0 | -12.0 mm | 10.0 |
| ch4 | -10.0 mm | 3.8 | -0.5 mm | 5.2 |
| **spread** | **11 mm** | | **26.5 mm** | |

Raw surfaces: rail1 runs ch1 ~404 mm down to ch4 ~393 mm; rail2 runs the
**opposite way**, ch4 ~407 mm up to ch1 ~380 mm. Two rigs, two different tilts,
neither coplanar. The IQRs are tight (2-10 mm) over 33 sites x 11 stops, so
this is systematic geometry, not measurement noise.

Note also every offset is **negative**: the pooled plane sits farther than every
channel's real surface, because the 40th-90th-percentile band still admits some
of the cardboard in the inter-channel gaps. So canopy heights are biased
**high** across the board, by 2-10 mm (rail1) and 0-27 mm (rail2).

### This re-explains a master-file conclusion

§7.2b records: *"The rail-2 false positives were all ch1 (edge channel,
x~63-74) protruding a consistent 28-35 mm — one structural thing (shelf/tent/
channel lip) catching a green cast, not four plants."*

Rail2's pooled plane is ~407 mm and ch1's real surface is ~380 mm.
`407 - 380 = 27 mm`. The "consistent 28-35 mm protrusion" is the plane bias
itself — ch1's own channel surface, reading as protruding because the plane it
is compared against belongs mostly to the other three channels. No shelf
required.

That matters because §7.2b's height gate is presented as the robust one —
*"physics: plants protrude, channels don't"*. On rail2/ch1 the channel **does**
protrude, by 27 mm, against an 8 mm gate. The gate is defeated there by
geometry, not by appearance, and no amount of colour tuning fixes it.

*Caveat, stated honestly:* this measurement cannot by itself distinguish "ch1's
channel surface is at 380 mm" from "a structure at 380 mm covers ch1's ROIs".
The 2.0 mm IQR across 33 sites and all 11 stops favours a continuous tilted
channel over a localised lip, but a spirit level on the rig would settle it in
seconds.

### Why this generalises to every future floor

Each floor's channels are separately mounted troughs with their own flow
gradient, so each will have its own per-channel offsets — different magnitude,
possibly different sign, as rail1 and rail2 already demonstrate. The current
single-scalar design will flatten all of them silently. Any new floor inherits
the defect on day one.

### Fix — structural, and it should land before any harvest calibration

1. **Measure the plane per (stop, channel), not per frame.** The site map
   already stores each site's ROI, so the estimator has everything it needs;
   restrict it to that channel's ROIs with a plausibility gate, as
   `channel_plane_check.py` does.
2. **Make it part of the fixed rig calibration, not a per-cycle fit.** The
   channels do not move. Measure the per-(stop, channel) plane once from an
   empty-rig scan (scan01/scan02 already exist for exactly this, §5.15) and
   store it alongside the site map. That is both more robust than re-fitting
   against a canopy that increasingly hides the surface, and it removes a
   whole-canopy-closure failure mode: once plants cover a channel there are
   barely any background pixels left to fit to.
3. **Widen `SiteObservation.channelPlaneMm` usage** — the column can stay a
   single Float per record, since a record already belongs to one site and
   therefore one channel. It simply needs to carry that channel's plane rather
   than the frame's pooled median. No migration needed.
4. **Re-run the empty-rig regression test** (§5.15) afterwards. With correct
   per-channel planes, rail2/ch1's phantom 27 mm protrusion should vanish, and
   the expected answer of 0 plants at 44 sites should hold without leaning on
   the colour gates to mask a geometry error.
5. **Re-check the 8 mm height gate** once planes are right. It was set against
   heights that were biased high by 2-27 mm depending on channel and rail.

## What is still open — one physical measurement closes it

**Correction to an earlier version of this file:** it argued depth was "roughly
correct" because the plane reads ~405 mm against `camera_height_cm: 40.0`. That
reasoning does not hold — the master file says "~40 cm" throughout, a nominal
design figure, not a measurement. It cannot discriminate.

More importantly, **the camera cannot validate its own scale.** A multiplicative
depth bias scales the camera's height reading by the same factor, so no
camera-derived height — however carefully measured — can reveal it. What *was*
settled without a tape measure:

- **Depth is perpendicular, not radial.** If the pipeline were treating a radial
  distance as perpendicular z, a flat plane would read farther off-axis by
  `sec(theta)` — predicted +18.5%. Observed: −4.3% (rail1) and +2.5% (rail2),
  i.e. −0.23x and +0.13x of the prediction. Hypothesis rejected on both rails.
  (`plane_check.py`.)

So an external length reference is still required. Two possibilities remain:

| If the true row pitch is… | Then… |
| --- | --- |
| **130.8 mm** (as assumed) | the cameras' lateral scale is wrong by 8% / 15% — `fy`/`cx,cy` or the aligned-stream intrinsics need re-deriving per rail. |
| **~121 mm** (what rail1's camera sees) | rail1's camera is right, and `MM_PER_STEP = 10/1024` is wrong — the real figure is ~1108 steps/cm, making the master file's "13398 steps = 13.08 cm" wrong too. |

Note the assumed 13.08 cm is **not** an independent measurement: it was derived
from the anchor hunt *using* 1024 steps/cm (§4.1), so pitch and step scale are
circular. Nothing has ever broken that circle.

**Please measure, on each floor — row pitch is the one that matters:**

1. **Row pitch (primary).** Tape from the centre of row 1 to the centre of row
   11, then divide by 10. Measuring over 10 rows divides your tape error by 10,
   giving ~±1 mm effective precision on a ~131 mm quantity — easily enough to
   separate 130.8 from 121.
2. **Camera height (secondary, cross-check only).** Deliberately demoted: it is
   a single short distance to a lens whose optical centre sits somewhere inside
   the housing, so ±3–5 mm is the realistic best case — which is the same order
   as the effect being tested. Useful as a sanity check, not as the reference.

Any object of known length laid along a channel would serve equally well. The
row pitch is simply free, and it is the specific number that breaks §4.1's
circularity.

## Then fix

1. Put `y_scale` (and camera height, if it differs from 40.0) in
   `rails/railN.json`, defaulting to 1.0 so nothing changes until set.
2. Re-derive intrinsics per rail if the pitch is confirmed at 130.8 mm.
3. Re-run `coreg_check.py`; overlap ratio should fall from ~0.80 toward ~0.4.
4. Bump `schema` in the emitted records so the discontinuity is visible in the
   database rather than inferred from dates.
5. Add the before/after numbers to
   [`observations-pipeline-changelog.md`](observations-pipeline-changelog.md).

**Timing: at a batch boundary.** B-2026-023 (Floor 1 lettuce, planted
2026-08-23) is mid-grow; a step change mid-series is worse than a consistently
wrong one. Floor 1 has no harvest recorded, so nothing downstream depends on
the current values — but note that **any harvest calibration fitted before this
is fixed will bake the scale error into its constants.**

## Also: `fusionGainPct`

Definition is legitimate — `100*(fused − nadir)/nadir` — but unusable: a ratio
with a near-zero denominator, observed to **8057%**, and inflated by the very
error above. Don't gate on it. Use `nViewsFused` and `depthValidPct`.

## Diagnostics

All three are read-only, in [`rail-diagnostics/`](rail-diagnostics/). Copy to
the rail Pi's `agrivision/` dir (they import `merge_views`, `measure_plants`,
`gates` from there) and run with system `python3`:

```bash
scp docs/rail-diagnostics/*.py pi4-004@pi4-004:/tmp/
ssh pi4-004@pi4-004
cd ~/agrivision-edge/nodes/pilot-basement/pi4-004-rail/agrivision
cp /tmp/*.py .

python3 scale_check.py --dir cycles/<CYCLE> --site-map site_map_rail1_mv.json \
    --row-pitch-mm 130.8          # camera scale, independent of the rail
python3 plane_check.py --dir cycles/<CYCLE>   # plane tilt/gradient + radial test
python3 channel_plane_check.py --dir cycles/<CYCLE> \
    --site-map site_map_rail1_mv.json         # per-channel plane offsets
python3 fit_yscale.py  --dir cycles/<CYCLE> --site-map site_map_rail1_mv.json \
    --row-direction 1             # cross-view scalar
python3 coreg_check.py --dir cycles/<CYCLE> --site-map site_map_rail1_mv.json \
    --row-direction 1 --row-pitch-mm 130.8   # acceptance test

rm -f scale_check.py fit_yscale.py coreg_check.py plane_check.py channel_plane_check.py
```

`scale_check.py` is the one that isolates the camera term — run it first.
