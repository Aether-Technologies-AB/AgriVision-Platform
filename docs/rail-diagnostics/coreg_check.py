#!/usr/bin/env python3
"""
coreg_check.py — read-only diagnostic: do the 3 views actually co-register?

Answers one question and writes nothing: when merge_views fuses a pot's three
views into one world height map, do the three point clouds land ON TOP of each
other (correct — fusion then recovers occluded leaf) or SIDE BY SIDE (broken —
fusion then triple-counts the same plant)?

The discriminator is cell overlap. For each pot:
    sum_cells   = filled cells if each view is rasterised alone, added up
    fused_cells = filled cells of the union height map
    ratio       = fused_cells / sum_cells
  ratio ~ 1/nviews  -> views land on each other  (co-registered, healthy)
  ratio ~ 1         -> views land apart          (misregistered, triple-count)

Also prints each view's median Yw so misregistration can be read in mm and
compared against the row pitch from rails/railN.json (rail1: 130.8 mm).

Run on the rail Pi, from the agrivision/ dir that holds merge_views.py.
"""

import argparse
import glob
import json
import os
from collections import defaultdict

import numpy as np

import gates
from merge_views import parse_capture, segment, deproject, fuse
from measure_plants import clean_depth, fit_channel_plane


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="a cycle directory of captures")
    ap.add_argument("--site-map", required=True)
    ap.add_argument("--row-direction", type=int, default=1, choices=[1, -1])
    ap.add_argument("--cell-mm", type=float, default=1.0)
    ap.add_argument("--row-pitch-mm", type=float, default=130.8)
    ap.add_argument("--max-sites", type=int, default=12)
    gates.add_gate_args(ap)
    args = ap.parse_args()

    smap = json.load(open(args.site_map))
    per_stop = smap["sites_per_stop"]

    pot_points = defaultdict(dict)
    planes = []

    for p in sorted(glob.glob(os.path.join(args.dir, "*_scan_stop*_rgb.jpg"))):
        si, P = parse_capture(p)
        if si is None or str(si) not in per_stop:
            continue
        base = p[: -len("_rgb.jpg")]
        rgb = __import__("cv2").imread(p)
        depth_mm = clean_depth(np.load(base + "_depth.npy"))
        intr = json.load(open(base + "_intrinsics.json"))
        mask, exg = segment(rgb, args.exg, args.min_brightness)
        plane = fit_channel_plane(depth_mm, mask)
        if not np.isfinite(plane):
            continue
        planes.append(plane)
        for s in per_stop[str(si)]["sites"]:
            x, y, w, h = s["roi_xywh"]
            sub = mask[y : y + h, x : x + w]
            if sub.sum() < args.min_area:
                continue
            e = exg[y : y + h, x : x + w][sub]
            if e.size and float((e > gates.DEEP_GREEN_EXG).mean()) < args.min_deep_green:
                continue
            pts = deproject(sub, depth_mm, intr, P, y, x, args.row_direction)
            if pts is None:
                continue
            pot_points[s["site_id"]][s["view_angle_deg"]] = pts

    plane_mm = float(np.median(planes)) if planes else None
    print(f"cycle dir: {args.dir}")
    print(f"channel plane: {plane_mm:.1f} mm   row pitch: {args.row_pitch_mm} mm")
    print(f"pots with plant pixels: {len(pot_points)}\n")

    hdr = (f"{'site':>12} {'nv':>3} {'sum_cells':>10} {'fused_cells':>12} "
           f"{'ratio':>6} {'1/nv':>6} {'Yw_spread_mm':>13}  verdict")
    print(hdr)
    print("-" * len(hdr))

    multi = {s: v for s, v in pot_points.items() if len(v) >= 2}
    ratios = []
    for sid, views in sorted(multi.items())[: args.max_sites]:
        r = fuse(views, plane_mm, args.cell_mm)
        if r is None:
            continue
        nv = len(views)
        sum_cells = sum(pv["cells"] for pv in r["per_view"].values())
        fused_cells = r["fused_cells"]
        ratio = fused_cells / sum_cells if sum_cells else float("nan")
        ymeds = [float(np.median(pts[:, 1])) for pts in views.values()]
        spread = max(ymeds) - min(ymeds)
        expected = 1.0 / nv
        # Halfway between "perfectly stacked" (1/nv) and "fully disjoint" (1.0)
        verdict = "CO-REGISTERED" if ratio < (expected + 1.0) / 2 else "MISREGISTERED"
        ratios.append(ratio)
        print(f"{sid:>12} {nv:>3} {sum_cells:>10} {fused_cells:>12} "
              f"{ratio:>6.2f} {expected:>6.2f} {spread:>13.1f}  {verdict}")

    if ratios:
        print(f"\nmean overlap ratio over {len(ratios)} multi-view pots: "
              f"{np.mean(ratios):.3f}")
        print("A ratio near 1/nviews means the views stack (fusion recovers "
              "occlusion).\nA ratio near 1.0 means they tile side by side "
              "(fusion multiplies the plant).")
        print("Yw_spread_mm near 0 = same physical row; near the row pitch = "
              "off by one row.")


if __name__ == "__main__":
    main()
