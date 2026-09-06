#!/usr/bin/env python3
"""
geo_plane.py — the ARITHMETIC channel-plane chain, no ML, run over all 11 stops.

THE CHAIN
  per (stop, channel):
    1. band     = that channel's own ROI x-extent from the site map
                  (the FULL ROI, not a tight band: hand-read depth showed the
                  tight cup-centreline band is biased ~15 mm low because it
                  locks onto the raised lip around each cup hole)
    2. exclude  = known cup circles, dilated; plus plant pixels from the
                  production ExG mask; plus invalid or implausible depth
    3. fit      = ITERATIVELY TRIMMED least squares z = a*u + b*v + c.
                  The trimming is not optional: plain least squares over the
                  same pixels gave 13-24 mm residuals and tilts to -11.6 deg,
                  because the inter-channel cardboard and the trough side walls
                  drag it off the top face.
    4. gate     = minimum kept pixels AND maximum residual, so a bad fit is
                  reported as a failure rather than returned as a number.

VALIDATION WITHOUT GROUND TRUTH
  Hand-read depth is available for one stop only. But there is a strong
  self-consistency check that needs no reference: a channel is a continuous
  physical object, so its camera distance must vary SMOOTHLY along the rail.
  Fitting a straight line to plane-vs-stop per channel gives the slope (the NFT
  flow gradient, or rail sag) and the scatter about that line is a pure
  measurement-quality number. Large scatter = bad fits, whatever the true
  distances are.
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
from measure_plants import clean_depth, fit_channel_plane

MIN_PIX = 500
MAX_RESID_MM = 8.0


def fit_seeded(us, vs, z, tol=8.0, min_pix=MIN_PIX, passes=2):
    """MEDIAN-SEEDED plane fit: median sets the datum, the fit only adds tilt.

    Why not a plain trimmed fit over the same pixels — measured twice:
      * FULL ROI + trimmed plane: the band overruns the trough onto the
        inter-channel cardboard, and trimming happily converges onto THAT as
        the dominant low-variance surface. Result: 21 of 44 (stop, channel)
        fits blew the residual gate and ch2/ch3 failed almost everywhere.
      * TIGHT band + trimmed plane: fits cleanly (residuals 2-4 mm) but the
        datum comes out ~15 mm NEAR of hand-read depth, because in a narrow
        band the raised lip around each cup hole is a low-variance minority
        the trimming drifts onto.

    The median over the full ROI is the one estimator that matched hand-read
    depth (manual 404.5/397.5/394.5/398.5 for ch1..ch4 against ROI-median
    404/397-401/393-398/391-395). So: take the median as the datum, keep only
    pixels within `tol` of it, and fit a plane to those. The datum is then
    immune to a competing surface, and the fit still recovers the tilt.

    Returns (coef, n_kept, rms, median).
    """
    us = us.astype(np.float64); vs = vs.astype(np.float64); z = z.astype(np.float64)
    med = float(np.median(z))
    coef = np.array([0.0, 0.0, med])
    keep = np.abs(z - med) <= tol
    if int(keep.sum()) < min_pix:
        return coef, int(keep.sum()), float("nan"), med
    for _ in range(passes):
        A = np.stack([us[keep], vs[keep], np.ones(int(keep.sum()))], axis=1)
        coef, *_ = np.linalg.lstsq(A, z[keep], rcond=None)
        pred = np.stack([us, vs, np.ones_like(z)], axis=1) @ coef
        # re-select around the FITTED plane, but never stray from the median
        # datum by more than tol -- that is what stops it walking onto the lip
        # or the cardboard.
        nk = (np.abs(z - pred) <= tol) & (np.abs(z - med) <= tol)
        if int(nk.sum()) < min_pix:
            break
        keep = nk
    pred = np.stack([us, vs, np.ones_like(z)], axis=1) @ coef
    rms = float(np.sqrt(np.mean((z[keep] - pred[keep]) ** 2)))
    return coef, int(keep.sum()), rms, med


def detect_channel_runs(depth, exclude, min_run=50, tol=15.0, bridge=60):
    """Find each channel's own column extent from the depth map. SELF-LOCATING.

    Trusting the site map's ROI columns fails: the ROI tiles half-way to the
    neighbouring hole, so ~17% of its width is inter-channel gap, and once
    plants are excluded the median can tip onto that gap. Measured on
    2026-09-02_19-07-13: ch2 read 443-446 mm at six of eleven stops and 398 mm
    at the other five — two surfaces ~45 mm apart, with hand-read depth
    confirming 397.5 mm as the true one. A 21 mm scatter from a band that is
    nominally correct.

    So detect the trough instead of assuming it. Per column, take the median
    depth of usable pixels; channel columns cluster tightly around the modal
    depth while gap columns sit far behind or have no depth at all. Contiguous
    runs of channel columns ARE the channels. This also means the whole chain
    positions itself: if a trough is nudged sideways, the detected run moves
    with it instead of silently measuring the gap.

    Depth-based on purpose, so it works with the grow lights off too.
    """
    H, W = depth.shape
    usable = np.isfinite(depth) & (~exclude)
    col_med = np.full(W, np.nan)
    for x in range(W):
        col = depth[:, x][usable[:, x]]
        if col.size >= max(20, H // 12):
            col_med[x] = np.median(col)
    ok = np.isfinite(col_med)
    if ok.sum() < min_run:
        return []
    mode = float(np.median(col_med[ok]))
    is_ch = ok & (np.abs(col_med - mode) <= tol)

    raw, start = [], None
    for x in range(W + 1):
        inside = bool(is_ch[x]) if x < W else False
        if inside and start is None:
            start = x
        elif not inside and start is not None:
            raw.append((start, x))
            start = None

    # Bridge short breaks BEFORE applying the length test. A plant sitting on
    # the trough blanks the columns it covers, chopping one physical channel
    # into fragments that each fall under min_run — which is how a strict
    # detector lost 13 of 44 (stop, channel) fits at ~15% canopy coverage while
    # the fits it DID make were the best of any variant tried.
    merged = []
    for r in raw:
        if merged and r[0] - merged[-1][1] <= bridge:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(list(r) if False else (r[0], r[1]))
        merged[-1] = tuple(merged[-1])
    merged = [tuple(m) for m in merged]
    return [m for m in merged if m[1] - m[0] >= min_run]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--site-map", required=True)
    ap.add_argument("--lo", type=float, default=300.0)
    ap.add_argument("--hi", type=float, default=500.0)
    ap.add_argument("--cup-margin", type=float, default=1.3)
    ap.add_argument("--exg", type=float, default=0.14)
    ap.add_argument("--min-brightness", type=float, default=120.0)
    args = ap.parse_args()

    smap = json.load(open(args.site_map))
    per_stop = smap["sites_per_stop"]

    results = {}     # (stop, ch) -> (plane_at_centre, tilt_deg, n, rms)
    sources = {}     # (stop, ch) -> 'det' (self-located) or 'MAP' (fallback)
    pooled_by_stop = {}
    centres = {}

    for p in sorted(glob.glob(os.path.join(args.dir, "*_scan_stop*_rgb.jpg"))):
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
        plant, _ = segment(rgb, args.exg, args.min_brightness)
        if not lit:
            plant = np.zeros(depth.shape, bool)   # colour is meaningless unlit
        pooled_by_stop[si] = fit_channel_plane(depth, plant)

        by_ch = defaultdict(list)
        cups = np.zeros((H, W), np.uint8)
        for s in per_stop[str(si)]["sites"]:
            by_ch[int(s["channel"])].append(s)
            if s.get("r"):
                cv2.circle(cups, (int(s["cx"]), int(s["cy"])),
                           int(round(float(s["r"]) * args.cup_margin)), 1, -1)
        cups = cups.astype(bool)

        # Self-located channel extents, then map each run to a channel number by
        # which run contains that channel's cup centres.
        runs = detect_channel_runs(depth, cups | plant)
        run_for_ch = {}
        for ch, ss in sorted(by_ch.items()):
            cx = float(np.median([float(s["cx"]) for s in ss]))
            for (a, b) in runs:
                if a <= cx < b:
                    run_for_ch[ch] = (a, b)
                    break
        if si == min(int(k) for k in per_stop):
            print(f"  [stop {si}] detected {len(runs)} channel runs: "
                  + ", ".join(f"{a}-{b}" for a, b in runs))

        for ch, ss in sorted(by_ch.items()):
            if ch in run_for_ch:
                x0, x1 = run_for_ch[ch]
                src = "det"
            else:
                # Documented fallback, never a silent substitution: use the site
                # map's ROI columns and mark the record as such.
                x0 = min(s["roi_xywh"][0] for s in ss)
                x1 = max(s["roi_xywh"][0] + s["roi_xywh"][2] for s in ss)
                src = "MAP"
            sources[(si, ch)] = src
            band = np.zeros((H, W), bool)
            band[:, x0:x1] = True
            sel = (band & (~cups) & (~plant) & np.isfinite(depth)
                   & (depth >= args.lo) & (depth <= args.hi))
            centres[ch] = 0.5 * (x0 + x1)
            if int(sel.sum()) < MIN_PIX:
                results[(si, ch)] = None
                continue
            coef, nkept, rms, med = fit_seeded(uu[sel], vv[sel], depth[sel])
            plane_c = coef[0] * centres[ch] + coef[1] * (H / 2.0) + coef[2]
            tilt = float(np.degrees(np.arctan(coef[0])))
            results[(si, ch)] = (plane_c, tilt, nkept, rms)

    stops = sorted({k[0] for k in results})
    chans = sorted({k[1] for k in results})

    print(f"cycle: {os.path.basename(args.dir.rstrip('/'))}   "
          f"{len(stops)} stops x {len(chans)} channels\n")
    hdr = f"{'stop':>5} {'pooled':>7} " + " ".join(f"{'ch'+str(c):>16}" for c in chans)
    print(hdr)
    print(f"{'':>5} {'(mm)':>7} " + " ".join(f"{'plane  rms   n':>16}" for c in chans))
    print("-" * len(hdr))
    fails = 0
    for si in stops:
        cells = []
        for c in chans:
            r = results.get((si, c))
            if r is None or r[3] > MAX_RESID_MM:
                cells.append(f"{'FAIL':>16}")
                fails += 1
            else:
                cells.append(f"{r[0]:>6.1f} {r[3]:>4.1f} {r[2]//1000:>3}k{sources.get((si,c),'?')[0]}")
        print(f"{si:>5} {pooled_by_stop.get(si, float('nan')):>7.1f} " + " ".join(cells))

    print(f"\nfits failing the {MAX_RESID_MM:.0f} mm residual gate: "
          f"{fails}/{len(stops)*len(chans)}")

    print("\nSELF-CONSISTENCY — a channel is one continuous object, so its")
    print("distance must vary smoothly along the rail. Straight-line fit per")
    print("channel; the scatter needs no ground truth to be meaningful.\n")
    print(f"{'ch':>4} {'n':>4} {'mean mm':>9} {'slope mm/stop':>14} "
          f"{'total drop mm':>14} {'scatter (sd) mm':>16}")
    for c in chans:
        xs = [si for si in stops if results.get((si, c)) and results[(si, c)][3] <= MAX_RESID_MM]
        ys = [results[(si, c)][0] for si in xs]
        if len(xs) < 3:
            print(f"{c:>4} {len(xs):>4}   too few good fits")
            continue
        A = np.stack([np.array(xs, float), np.ones(len(xs))], axis=1)
        coef, *_ = np.linalg.lstsq(A, np.array(ys), rcond=None)
        pred = A @ coef
        sd = float(np.std(np.array(ys) - pred))
        print(f"{c:>4} {len(xs):>4} {np.mean(ys):>9.1f} {coef[0]:>+14.2f} "
              f"{coef[0]*(max(xs)-min(xs)):>+14.1f} {sd:>16.2f}")

    goods = [results[k][0] for k in results if results[k] and results[k][3] <= MAX_RESID_MM]
    pool = [pooled_by_stop[s] for s in stops]
    print(f"\narithmetic planes: {min(goods):.1f} .. {max(goods):.1f} mm "
          f"(spread {max(goods)-min(goods):.1f})")
    print(f"production pooled: {min(pool):.1f} .. {max(pool):.1f} mm "
          f"(one value per stop, shared by all 4 channels)")


if __name__ == "__main__":
    main()
