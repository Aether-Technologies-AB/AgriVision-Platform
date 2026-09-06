#!/usr/bin/env python3
"""
channel_plane_fit.py — prototype: fit an INDEPENDENT TILTED PLANE per channel,
from that channel's own surface pixels, and find out where it breaks down.

Replaces `fit_channel_plane`'s single pooled scalar per frame with, per
(stop, channel):
    z = a*(u-cx) + b*(v-cy) + c          least squares over channel pixels
giving that channel's own distance AND its tilt, plus a fit residual.

Channel pixels are: inside the channel's x-extent, NOT plant, depth within a
plausible band, and NOT inside a net-pot cup. The cup exclusion matters — cups
protrude ABOVE the rim, so any that leak in pull the plane toward the camera.
Their positions are known exactly (cx, cy, r in the site map), so they are
masked geometrically rather than hoped away by the brightness filter.

DEGRADATION TEST (--erode-steps): the honest question is not whether this works
today but when it stops working as the canopy closes. We simulate closure by
progressively DILATING the plant mask and re-fitting, reporting how the plane
drifts and the residual grows as available channel pixels vanish. That tells us
the coverage at which a fallback must take over.

Read-only. Run from the rail Pi's agrivision/ directory.
"""

import argparse
import glob
import json
import os
from collections import defaultdict

import numpy as np
import cv2

import gates
from merge_views import parse_capture, segment
from measure_plants import clean_depth, fit_channel_plane

MIN_PIX = 400          # below this a plane fit is not trustworthy
MAX_RESID_MM = 8.0     # above this the fit is not describing a plane


def fit_plane(us, vs, z, cx, cy, trims=4, keep_sigma=2.0):
    """Robust (iteratively trimmed) least-squares z = a*(u-cx) + b*(v-cy) + c.

    Plain least squares FAILS here, measured: a loosely-defined channel band
    also contains the inter-channel cardboard (much farther) and the trough's
    sloping side walls, and least squares is dragged by both — residuals of
    13-24 mm and tilts up to -11.6 deg, i.e. not describing a plane at all.

    Trimming locks onto the dominant planar surface (the channel top face) and
    discards the rest, which is exactly what a robust estimator is for. This is
    a poor-man's RANSAC: fit, drop everything beyond keep_sigma, refit. It also
    makes the whole thing tolerant of leaf fragments the ExG mask missed, which
    is what "not failable" actually requires.

    Returns (a, b, c, resid_rms, n_kept).
    """
    us = us.astype(np.float64); vs = vs.astype(np.float64); z = z.astype(np.float64)
    keep = np.ones(z.shape, bool)
    coef = None
    for _ in range(trims):
        A = np.stack([us[keep] - cx, vs[keep] - cy, np.ones(int(keep.sum()))], axis=1)
        coef, *_ = np.linalg.lstsq(A, z[keep], rcond=None)
        Afull = np.stack([us - cx, vs - cy, np.ones_like(z)], axis=1)
        resid = z - Afull @ coef
        sd = float(np.std(resid[keep]))
        if sd <= 1e-6:
            break
        newkeep = np.abs(resid) <= keep_sigma * sd
        if int(newkeep.sum()) < MIN_PIX or newkeep.sum() == keep.sum():
            break
        keep = newkeep
    Afull = np.stack([us - cx, vs - cy, np.ones_like(z)], axis=1)
    resid = (z - Afull @ coef)[keep]
    return (float(coef[0]), float(coef[1]), float(coef[2]),
            float(np.sqrt(np.mean(resid ** 2))), int(keep.sum()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--site-map", required=True)
    ap.add_argument("--lo", type=float, default=300.0)
    ap.add_argument("--hi", type=float, default=500.0)
    ap.add_argument("--band-radii", type=float, default=1.8,
                    help="channel top-face half-width, in cup radii")
    ap.add_argument("--cup-margin", type=float, default=1.15,
                    help="multiply cup radius by this before masking it out")
    ap.add_argument("--erode-steps", type=int, default=0,
                    help="simulate canopy closure: dilate the plant mask N times")
    ap.add_argument("--stops", default="", help="comma list, default all")
    gates.add_gate_args(ap)
    args = ap.parse_args()

    smap = json.load(open(args.site_map))
    per_stop = smap["sites_per_stop"]
    want = {s.strip() for s in args.stops.split(",") if s.strip()}

    rows = []
    for p in sorted(glob.glob(os.path.join(args.dir, "*_scan_stop*_rgb.jpg"))):
        si, _ = parse_capture(p)
        if si is None or str(si) not in per_stop:
            continue
        if want and str(si) not in want:
            continue
        base = p[: -len("_rgb.jpg")]
        rgb = cv2.imread(p)
        depth = clean_depth(np.load(base + "_depth.npy"))
        intr = json.load(open(base + "_intrinsics.json"))
        cxi, cyi = float(intr["cx"]), float(intr["cy"])
        mask, _ = segment(rgb, args.exg, args.min_brightness)

        pooled = fit_channel_plane(depth, mask)

        # Simulate canopy closure by growing the plant mask.
        if args.erode_steps:
            k = np.ones((9, 9), np.uint8)
            mask = cv2.dilate(mask.astype(np.uint8), k,
                              iterations=args.erode_steps).astype(bool)

        # Cup exclusion mask, from the site map's known cup circles.
        cups = np.zeros(mask.shape, np.uint8)
        by_ch = defaultdict(list)
        for s in per_stop[str(si)]["sites"]:
            by_ch[int(s["channel"])].append(s)
            if s.get("r"):
                cv2.circle(cups, (int(s["cx"]), int(s["cy"])),
                           int(round(float(s["r"]) * args.cup_margin)), 1, -1)
        cups = cups.astype(bool)

        H, W = depth.shape
        vv, uu = np.mgrid[0:H, 0:W]

        for ch, sites in sorted(by_ch.items()):
            # Band = the channel TOP FACE, not the whole ROI. Centred on the
            # cup centreline (cups are drilled through the top face, so their
            # centres ARE the channel centreline) and half-width scaled from the
            # cup radius. The full ROI tiles half-way to the neighbouring hole
            # (site map, master file 6), so it overruns the trough onto the
            # cardboard -- which is what broke the un-trimmed fit.
            cxs = [float(s["cx"]) for s in sites]
            rs = [float(s["r"]) for s in sites if s.get("r")]
            centre = float(np.median(cxs))
            half = (np.median(rs) if rs else 38.0) * args.band_radii
            x0 = max(0, int(centre - half)); x1 = min(mask.shape[1], int(centre + half))
            band = np.zeros(mask.shape, bool)
            band[:, x0:x1] = True

            sel = (band & (~mask) & (~cups)
                   & np.isfinite(depth) & (depth >= args.lo) & (depth <= args.hi))
            n = int(sel.sum())
            total = int(band.sum())
            if n < MIN_PIX:
                rows.append((si, ch, n, total, None, None, None, None, pooled))
                continue
            a, b, c, resid, nkept = fit_plane(uu[sel], vv[sel], depth[sel], cxi, cyi)
            rows.append((si, ch, nkept, total, a, b, c, resid, pooled))

    print(f"{'stop':>5} {'ch':>3} {'pix':>7} {'%avail':>7} {'plane_mm':>9} "
          f"{'resid':>6} {'tilt_u':>7} {'tilt_v':>7} {'pooled':>7} {'delta':>7} {'ok':>4}")
    print("-" * 88)
    ok_ct = fail_ct = 0
    deltas = []
    for si, ch, n, total, a, b, c, resid, pooled in rows:
        pct = 100.0 * n / max(total, 1)
        if c is None:
            print(f"{si:>5} {ch:>3} {n:>7} {pct:>6.1f}% {'-':>9} {'-':>6} "
                  f"{'-':>7} {'-':>7} {pooled:>7.1f} {'-':>7} {'FAIL':>4}")
            fail_ct += 1
            continue
        tu = np.degrees(np.arctan(a))
        tv = np.degrees(np.arctan(b))
        good = resid <= MAX_RESID_MM
        ok_ct += good
        fail_ct += (not good)
        d = c - pooled
        deltas.append(d)
        print(f"{si:>5} {ch:>3} {n:>7} {pct:>6.1f}% {c:>9.1f} {resid:>6.2f} "
              f"{tu:>7.2f} {tv:>7.2f} {pooled:>7.1f} {d:>+7.1f} "
              f"{'ok' if good else 'HIGH':>4}")

    print(f"\nfits within residual limit: {ok_ct}/{ok_ct+fail_ct}")
    if deltas:
        d = np.array(deltas)
        print(f"per-channel plane vs pooled: mean {d.mean():+.1f} mm, "
              f"range {d.min():+.1f}..{d.max():+.1f}")
    if args.erode_steps:
        print(f"(simulated closure: plant mask dilated {args.erode_steps}x with a 9x9 kernel)")


if __name__ == "__main__":
    main()
