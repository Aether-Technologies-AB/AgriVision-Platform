#!/usr/bin/env python3
"""
scale_check.py — is the CAMERA-frame scale right, independent of the rail?

The cross-view registration fit says the camera-frame Y term is 8-16% too
small. Two things could cause that: (a) the camera scale (fy / depth) is wrong,
or (b) the rail translation (steps -> mm) is wrong. The cross-view fit cannot
tell them apart, because both vary together across stops.

This separates them. Within ONE image, several rows of pots are visible at
once. Their separation in camera-frame Y involves NO rail motion at all:

    Y = (v - cy) * z / fy      dY between two rows in the same frame

Physically those rows are `row_pitch_mm` apart. So:

    measured dY / (row_delta * row_pitch_mm)  ==  1.0   if the camera scale is right
                                              <  1.0   if camera Y is under-measured

If this comes out ~0.92 on rail1 and ~0.87 on rail2 — matching the fitted
y_scale of 1.082 and 1.156 — the fault is the CAMERA term. If it comes out
~1.00, the camera is fine and the RAIL step scale is the fault instead.

Read-only. Run from the rail Pi's agrivision/ directory.
"""

import argparse
import glob
import json
import os

import numpy as np
import cv2

import gates
from merge_views import parse_capture, segment
from measure_plants import clean_depth, fit_channel_plane


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--site-map", required=True)
    ap.add_argument("--row-pitch-mm", type=float, default=130.8)
    gates.add_gate_args(ap)
    args = ap.parse_args()

    smap = json.load(open(args.site_map))
    per_stop = smap["sites_per_stop"]

    ratios = []
    print(f"{'stop':>5} {'rowA':>6} {'rowB':>6} {'d_row':>6} "
          f"{'measured_dY':>12} {'expected':>9} {'ratio':>6}")
    print("-" * 60)

    for p in sorted(glob.glob(os.path.join(args.dir, "*_scan_stop*_rgb.jpg"))):
        si, P = parse_capture(p)
        if si is None or str(si) not in per_stop:
            continue
        base = p[: -len("_rgb.jpg")]
        rgb = cv2.imread(p)
        depth_mm = clean_depth(np.load(base + "_depth.npy"))
        intr = json.load(open(base + "_intrinsics.json"))
        fy, cy = float(intr["fy"]), float(intr["cy"])
        mask, exg = segment(rgb, args.exg, args.min_brightness)
        plane = fit_channel_plane(depth_mm, mask)
        if not np.isfinite(plane):
            continue

        # Camera-frame Y of each detected pot in THIS frame, keyed by global row.
        by_row = {}
        for s in per_stop[str(si)]["sites"]:
            x, y, w, h = s["roi_xywh"]
            sub = mask[y : y + h, x : x + w]
            if sub.sum() < args.min_area:
                continue
            e = exg[y : y + h, x : x + w][sub]
            if e.size and float((e > gates.DEEP_GREEN_EXG).mean()) < args.min_deep_green:
                continue
            vs, us = np.where(sub)
            z = depth_mm[vs + y, us + x]
            ok = np.isfinite(z)
            if ok.sum() == 0:
                continue
            Y = ((vs + y)[ok] - cy) * z[ok] / fy
            by_row.setdefault(int(s["global_row"]), []).append(float(np.median(Y)))

        rows = sorted(by_row)
        for a, b in zip(rows, rows[1:]):
            d_row = b - a
            if d_row <= 0:
                continue
            ya = float(np.median(by_row[a]))
            yb = float(np.median(by_row[b]))
            measured = abs(yb - ya)
            expected = d_row * args.row_pitch_mm
            ratio = measured / expected
            ratios.append(ratio)
            print(f"{si:>5} {a:>6} {b:>6} {d_row:>6} "
                  f"{measured:>12.1f} {expected:>9.1f} {ratio:>6.3f}")

    if ratios:
        r = np.array(ratios)
        print(f"\nn={len(r)}  mean ratio {r.mean():.3f}  median {np.median(r):.3f}  "
              f"sd {r.std():.3f}")
        print(f"implied camera-side correction: {1/r.mean():.3f}x")
        print("\nCompare against the cross-view fitted y_scale for this rail.")
        print("  match  -> the CAMERA term (fy or depth) is the fault")
        print("  ~1.000 -> the camera is fine; the RAIL step scale is the fault")
    else:
        print("no row pairs found in a single frame — cannot separate the terms")


if __name__ == "__main__":
    main()
