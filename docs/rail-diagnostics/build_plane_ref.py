#!/usr/bin/env python3
"""
build_plane_ref.py — STEP 1 of 2: build the per-(stop, channel) distance
reference, once, from clean frames.

THE TWO-STEP SPLIT, AND WHY IT MATTERS
  Step 1 (this script, offline): measure the camera-to-channel distance for
    every (stop, channel) from frames where the troughs are fully visible, and
    store it. Averaged over many cycles, so noise falls away and the
    cross-cycle scatter becomes an honest confidence number.
  Step 2 (runtime): the pipeline READS that reference instead of re-deriving it
    from a canopy-occluded frame every cycle. It only has to verify the
    reference still holds, and flag it when it does not.

  Trying to do both at once is what kept failing. Per-cycle detection on a
  planted frame is fragile because plants blank the very columns the detector
  needs: a strict detector lost 13 of 44 (stop, channel) fits at only ~15%
  canopy coverage, and a loose one merged ch1 and ch2 into a single run and
  reported the same distance for both. Neither problem exists on a clean frame.

BRIDGING, DONE PROPERLY
  A channel's columns get chopped up by whatever sits on the trough. Bridging
  short breaks is necessary, but bridging by DISTANCE alone is wrong — the
  inter-channel gap is only ~47 px, so any bridge wide enough to span a plant
  also welds two channels together. The distinction that actually matters is
  WHY a column has no answer:
      no usable pixels        -> UNKNOWN (plant/cup covered it) -> safe to bridge
      usable pixels, far away -> KNOWN NON-CHANNEL (the gap)    -> never bridge
  So bridging is allowed across unknown columns only, at any width.

VALIDATION
  Hand-read depth at stop 6 (16 points picked by eye off a gridded frame, all
  49/49 valid): ch1 404.5, ch2 397.5, ch3 394.5, ch4 398.5 mm. That is the
  reference this script must reproduce.
"""

import argparse
import glob
import json
import os
import re
from collections import defaultdict

import numpy as np
import cv2

from merge_views import segment
from measure_plants import clean_depth

MIN_PIX = 500
HAND = {1: 404.5, 2: 397.5, 3: 394.5, 4: 398.5}   # stop 6, by hand
HAND_STOP = 6


def column_state(depth, exclude, min_rows, tol):
    """Per column: 1 = channel, 0 = known non-channel, -1 = unknown (no data)."""
    H, W = depth.shape
    usable = np.isfinite(depth) & (~exclude)
    med = np.full(W, np.nan)
    for x in range(W):
        col = depth[:, x][usable[:, x]]
        if col.size >= min_rows:
            med[x] = np.median(col)
    ok = np.isfinite(med)
    if ok.sum() == 0:
        return np.full(W, -1, np.int8), med
    mode = float(np.median(med[ok]))
    st = np.where(~ok, -1, np.where(np.abs(med - mode) <= tol, 1, 0)).astype(np.int8)
    return st, med


def runs_from_state(st, min_run):
    """Contiguous channel runs, bridging UNKNOWN columns but never known gaps."""
    W = st.size
    runs, start, pending_unknown = [], None, 0
    for x in range(W):
        s = st[x]
        if s == 1:
            if start is None:
                start = x
            pending_unknown = 0
        elif s == -1:
            if start is not None:
                pending_unknown += 1        # hold the run open across unknowns
        else:                               # s == 0, the real gap
            if start is not None:
                runs.append((start, x - pending_unknown))
                start, pending_unknown = None, 0
    if start is not None:
        runs.append((start, W - pending_unknown))
    return [r for r in runs if r[1] - r[0] >= min_run]


def fit_seeded(us, vs, z, tol=8.0, min_pix=MIN_PIX, passes=2):
    us = us.astype(np.float64); vs = vs.astype(np.float64); z = z.astype(np.float64)
    med = float(np.median(z))
    coef = np.array([0.0, 0.0, med])
    keep = np.abs(z - med) <= tol
    if int(keep.sum()) < min_pix:
        return None
    for _ in range(passes):
        A = np.stack([us[keep], vs[keep], np.ones(int(keep.sum()))], axis=1)
        coef, *_ = np.linalg.lstsq(A, z[keep], rcond=None)
        pred = np.stack([us, vs, np.ones_like(z)], axis=1) @ coef
        nk = (np.abs(z - pred) <= tol) & (np.abs(z - med) <= tol)
        if int(nk.sum()) < min_pix:
            break
        keep = nk
    pred = np.stack([us, vs, np.ones_like(z)], axis=1) @ coef
    rms = float(np.sqrt(np.mean((z[keep] - pred[keep]) ** 2)))
    return coef, int(keep.sum()), rms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dirs", nargs="+", required=True, help="clean cycle dirs")
    ap.add_argument("--site-map", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--rail", default="rail1")
    ap.add_argument("--lo", type=float, default=300.0)
    ap.add_argument("--hi", type=float, default=500.0)
    ap.add_argument("--cup-margin", type=float, default=1.3)
    ap.add_argument("--col-tol", type=float, default=15.0)
    ap.add_argument("--min-run", type=int, default=50)
    ap.add_argument("--fixed-bands", default=None,
                    help="a previously built reference JSON; reuse its frozen "
                         "channel bands instead of detecting per frame")
    ap.add_argument("--plant-dilate", type=int, default=0,
                    help="dilate the plant mask N times before excluding it. "
                         "Used to test whether a reference shift is real rig "
                         "drift or just un-masked leaf pixels pulling the "
                         "median nearer: if the shift vanishes under heavier "
                         "exclusion, it was contamination, not movement.")
    args = ap.parse_args()

    fixed_bands = None
    if args.fixed_bands:
        fixed_bands = {k: v["band"] for k, v in
                       json.load(open(args.fixed_bands))["planes"].items()
                       if "band" in v}
        print(f"FIXED-BAND MODE: {len(fixed_bands)} frozen channel bands, "
              f"no runtime detection\n")

    smap = json.load(open(args.site_map))
    per_stop = smap["sites_per_stop"]
    samples = defaultdict(list)     # (stop, ch) -> [plane_at_centre]
    tilts = defaultdict(list)
    centres, nruns, bands_seen = {}, [], {}

    for d in args.dirs:
        for p in sorted(glob.glob(os.path.join(d, "*_scan_stop*_rgb.jpg"))):
            m = re.search(r"_scan_stop(\d+)_", os.path.basename(p))
            if not m or m.group(1) not in per_stop:
                continue
            si = int(m.group(1))
            stem = p[: -len("_rgb.jpg")]
            rgb = cv2.imread(p)
            depth = clean_depth(np.load(stem + "_depth.npy"))
            H, W = depth.shape
            vv, uu = np.mgrid[0:H, 0:W]

            lit = float(np.median(rgb.astype(np.float32).sum(axis=2))) > 150
            plant, _ = segment(rgb, 0.14, 120.0)
            if not lit:
                plant = np.zeros(depth.shape, bool)
            elif args.plant_dilate:
                plant = cv2.dilate(plant.astype(np.uint8), np.ones((9, 9), np.uint8),
                                   iterations=args.plant_dilate).astype(bool)

            by_ch = defaultdict(list)
            cups = np.zeros((H, W), np.uint8)
            for s in per_stop[str(si)]["sites"]:
                by_ch[int(s["channel"])].append(s)
                if s.get("r"):
                    cv2.circle(cups, (int(s["cx"]), int(s["cy"])),
                               int(round(float(s["r"]) * args.cup_margin)), 1, -1)
            cups = cups.astype(bool)

            if fixed_bands is not None:
                # FIXED-BAND MODE. No runtime detection at all: the channel
                # extents were determined once, offline, and frozen — the same
                # philosophy master file 6 applies to the site map itself
                # ("the sites are defined once ... and reused. No per-frame
                # detection, no drift correction"). This removes the two traps
                # that runtime detection introduced: a rig-dependent col_tol
                # that silently dropped ch1 on rail2 at 10 of 11 stops, and
                # unguarded over-detection of 5 runs where 4 is the only
                # correct answer. Measured drift over seven weeks was ~2 mm,
                # which does not justify detecting every cycle.
                runs = [tuple(fixed_bands[f"{si}|{ch}"])
                        for ch in sorted(by_ch) if f"{si}|{ch}" in fixed_bands]
            else:
                st, _ = column_state(depth, cups | plant, max(20, H // 12), args.col_tol)
                runs = runs_from_state(st, args.min_run)
            nruns.append(len(runs))

            for ch, ss in sorted(by_ch.items()):
                cx = float(np.median([float(s["cx"]) for s in ss]))
                run = next(((a, b) for a, b in runs if a <= cx < b), None)
                if run is None:
                    continue
                x0, x1 = run
                band = np.zeros((H, W), bool)
                band[:, x0:x1] = True
                sel = (band & (~cups) & (~plant) & np.isfinite(depth)
                       & (depth >= args.lo) & (depth <= args.hi))
                if int(sel.sum()) < MIN_PIX:
                    continue
                r = fit_seeded(uu[sel], vv[sel], depth[sel])
                if r is None:
                    continue
                coef, nkept, rms = r
                bands_seen.setdefault((si, ch), []).append((x0, x1))
                centres.setdefault(ch, []).append(0.5 * (x0 + x1))
                xc = 0.5 * (x0 + x1)
                samples[(si, ch)].append(coef[0] * xc + coef[1] * (H / 2.0) + coef[2])
                tilts[(si, ch)].append((float(coef[0]), float(coef[1])))

    print(f"channel runs detected per frame: min {min(nruns)}, "
          f"median {int(np.median(nruns))}, max {max(nruns)}  (4 is correct)\n")

    stops = sorted({k[0] for k in samples})
    chans = sorted({k[1] for k in samples})
    ref = {"rail": args.rail, "built_from": args.dirs, "planes": {}}

    print(f"{'stop':>5} " + " ".join(f"{'ch'+str(c):>18}" for c in chans))
    print(f"{'':>5} " + " ".join(f"{'mm   sd    n':>18}" for c in chans))
    print("-" * (6 + 19 * len(chans)))
    for si in stops:
        cells = []
        for c in chans:
            v = samples.get((si, c), [])
            if not v:
                cells.append(f"{'--':>18}")
                continue
            mm, sd = float(np.median(v)), float(np.std(v))
            a = float(np.median([t[0] for t in tilts[(si, c)]]))
            b = float(np.median([t[1] for t in tilts[(si, c)]]))
            bl = bands_seen.get((si, c), [])
            band = ([int(np.median([b[0] for b in bl])),
                     int(np.median([b[1] for b in bl]))] if bl else None)
            ref["planes"][f"{si}|{c}"] = {"band": band,
                                          "plane_mm": round(mm, 2),
                                          "a": round(a, 6), "b": round(b, 6),
                                          "n_cycles": len(v),
                                          "sd_mm": round(sd, 2)}
            cells.append(f"{mm:>7.1f} {sd:>4.1f} {len(v):>4}")
        print(f"{si:>5} " + " ".join(cells))

    sds = [v["sd_mm"] for v in ref["planes"].values()]
    print(f"\ncross-cycle scatter: mean {np.mean(sds):.2f} mm, "
          f"worst {max(sds):.2f} mm  (this is the confidence number)")

    print(f"\nVALIDATION vs hand-read depth at stop {HAND_STOP}:")
    print(f"{'ch':>4} {'hand mm':>9} {'reference mm':>13} {'diff':>7}")
    diffs = []
    for c in chans:
        k = f"{HAND_STOP}|{c}"
        if c in HAND and k in ref["planes"]:
            got = ref["planes"][k]["plane_mm"]
            diffs.append(got - HAND[c])
            print(f"{c:>4} {HAND[c]:>9.1f} {got:>13.1f} {got-HAND[c]:>+7.1f}")
    if diffs:
        print(f"\nabs-mean error vs hand: {np.mean(np.abs(diffs)):.2f} mm, "
              f"worst {np.max(np.abs(diffs)):.2f} mm")

    with open(args.out, "w") as fh:
        json.dump(ref, fh, indent=1)
    print(f"\nwrote {args.out}  ({len(ref['planes'])} (stop, channel) planes)")


if __name__ == "__main__":
    main()
