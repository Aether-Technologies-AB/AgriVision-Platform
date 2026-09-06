#!/usr/bin/env python3
"""
plane_check.py — what does the camera say the channel height IS, and is that
number the same everywhere in the frame?

`fit_channel_plane` collapses the channel surface to ONE scalar median, on the
stated grounds that "the channels were made coplanar and the camera looks
straight down". Three things can break that, and all three are measurable from
a single capture with no tape measure:

  1. TILT — camera not perpendicular, or channels not coplanar. Signature: a
     linear trend of z with u and/or v. Fit z = a*u + b*v + c.

  2. RADIAL vs PERPENDICULAR DEPTH — if the pipeline treats a RADIAL distance
     as a perpendicular z, then a flat plane reads FARTHER off-axis by exactly
        sec(theta) = sqrt(1 + ((u-cx)^2 + (v-cy)^2) / f^2)
     This matters enormously: it would inflate (v-cy)*z/fy off-axis, producing
     an apparent lateral-scale error that GROWS with distance from the
     principal point — which is what the -0.65 mm/deg cross-view drift looks
     like. It would also differ between the two rails, because they are
     laterally centred differently (master file section 2: rail1 camera moved
     +3 cm right, rail2 moved 5.3 cm left).

  3. Neither — z flat across the frame, so the scalar median is sound and the
     scale error lies in fy or in the assumed row pitch.

Output: observed z(r)/z(0) against the sec(theta) prediction, per radial bin.
Matching the prediction => radial-depth bug. Flat => the median is fine.

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--bins", type=int, default=7)
    gates.add_gate_args(ap)
    args = ap.parse_args()

    paths = sorted(glob.glob(os.path.join(args.dir, "*_scan_stop*_rgb.jpg")))
    if not paths:
        raise SystemExit("no captures found")

    acc_r, acc_z, acc_sec = [], [], []
    tilts = []

    for p in paths:
        si, _ = parse_capture(p)
        if si is None:
            continue
        base = p[: -len("_rgb.jpg")]
        rgb = cv2.imread(p)
        depth = np.load(base + "_depth.npy").astype(np.float32)
        intr = json.load(open(base + "_intrinsics.json"))
        fx, fy = float(intr["fx"]), float(intr["fy"])
        cx, cy = float(intr["cx"]), float(intr["cy"])

        mask, _ = segment(rgb, args.exg, args.min_brightness)

        # Channel-surface pixels: not plant, valid depth, and within the band
        # fit_channel_plane itself uses (40th-90th pct) so we study the same
        # population it does — excludes near noise and the far cardboard.
        depth[depth == 0] = np.nan
        depth[depth >= 65535] = np.nan
        bg = (~mask) & np.isfinite(depth)
        vals = depth[bg]
        if vals.size < 5000:
            continue
        lo, hi = np.percentile(vals, [40, 90])
        sel = bg & (depth >= lo) & (depth <= hi)

        vs, us = np.where(sel)
        z = depth[vs, us]
        du, dv = us - cx, vs - cy

        # 1) tilt: least-squares z = a*u + b*v + c
        A = np.stack([du, dv, np.ones_like(du, dtype=np.float64)], axis=1)
        coef, *_ = np.linalg.lstsq(A, z.astype(np.float64), rcond=None)
        a, b, c = coef
        # mm per pixel -> angle: a pixel subtends ~z/fx mm laterally
        tilt_u = np.degrees(np.arctan(a * fx / max(c, 1e-9)))
        tilt_v = np.degrees(np.arctan(b * fy / max(c, 1e-9)))
        tilts.append((si, a, b, c, tilt_u, tilt_v))

        # 2) radial signature
        r = np.sqrt(du ** 2 + dv ** 2)
        sec = np.sqrt(1.0 + (du ** 2 + dv ** 2) / (0.5 * (fx + fy)) ** 2)
        acc_r.append(r)
        acc_z.append(z)
        acc_sec.append(sec)

    print("=== tilt fit per stop:  z = a*(u-cx) + b*(v-cy) + c ===")
    print(f"{'stop':>5} {'c (mm)':>9} {'a mm/px':>9} {'b mm/px':>9} "
          f"{'tilt_u deg':>11} {'tilt_v deg':>11}")
    for si, a, b, c, tu, tv in tilts:
        print(f"{si:>5} {c:>9.1f} {a:>9.4f} {b:>9.4f} {tu:>11.2f} {tv:>11.2f}")
    if tilts:
        cs = np.array([t[3] for t in tilts])
        print(f"\nchannel plane distance across stops: mean {cs.mean():.1f} mm, "
              f"sd {cs.std():.1f}, min {cs.min():.1f}, max {cs.max():.1f}")

    r = np.concatenate(acc_r)
    z = np.concatenate(acc_z)
    sec = np.concatenate(acc_sec)

    edges = np.linspace(0, np.percentile(r, 99), args.bins + 1)
    print("\n=== radial signature: is a flat plane read as farther off-axis? ===")
    print(f"{'r_px':>12} {'n':>9} {'z_mean':>9} {'z/z0_obs':>9} "
          f"{'sec_pred':>9} {'delta':>8}")
    z0 = None
    rows = []
    for i in range(args.bins):
        m = (r >= edges[i]) & (r < edges[i + 1])
        if m.sum() < 500:
            continue
        zm = float(np.mean(z[m]))
        sm = float(np.mean(sec[m]))
        if z0 is None:
            z0, s0 = zm, sm
        obs = zm / z0
        pred = sm / s0
        rows.append((obs, pred))
        print(f"{edges[i]:>5.0f}-{edges[i+1]:>5.0f} {m.sum():>9} {zm:>9.1f} "
              f"{obs:>9.4f} {pred:>9.4f} {obs-pred:>+8.4f}")

    if rows:
        obs = np.array([x[0] for x in rows])
        pred = np.array([x[1] for x in rows])
        print(f"\nobserved growth over the radial range : {obs[-1]-1:+.4f}")
        print(f"predicted if depth were RADIAL        : {pred[-1]-1:+.4f}")
        print(f"predicted if depth were PERPENDICULAR : +0.0000")
        frac = (obs[-1] - 1) / (pred[-1] - 1) if abs(pred[-1] - 1) > 1e-9 else float("nan")
        print(f"\nfraction of the radial prediction observed: {frac:.2f}")
        print("  ~1.0 -> depth is RADIAL and is being used as perpendicular z")
        print("  ~0.0 -> depth is perpendicular; the scalar median is sound")


if __name__ == "__main__":
    main()
