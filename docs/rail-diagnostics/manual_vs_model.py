#!/usr/bin/env python3
"""
manual_vs_model.py — does the learned channel detector agree with a human
reading the depth map by hand?

METHOD, and why it is a fair test
  1. MANUAL: 16 pixel coordinates were chosen by LOOKING at the RGB frame with a
     coordinate grid drawn on it, picking only spots that are plainly white
     channel top face — clear of every cup and every inter-channel gap. Raw
     depth is read at each (median of a 7x7 patch, purely to damp sensor noise).
     Nothing about this touches the model, the site map, or the labelling rules.
  2. MODEL: the same frame is fed to the trained detector. Pixels above the
     precision threshold become the channel mask, a trimmed plane is fitted per
     channel, and that plane is EVALUATED AT THE SAME 16 COORDINATES.
  3. Compare. Also shown: the production pooled `fit_channel_plane` scalar,
     which is what the pipeline currently uses for every pixel in the frame.

  The manual points are the reference because they are the only number here
  that no algorithm chose.
"""

import argparse
import glob
import json
import os
import sys

import numpy as np
import cv2

import autolabel as AL
from train_channel import features, softmax, FEATURE_NAMES
from measure_plants import fit_channel_plane

# Hand-picked, by eye, from the gridded RGB frame. (x, y, channel)
MANUAL_POINTS = [
    (100, 160, 1), (160, 160, 1), (100, 350, 1), (160, 350, 1),
    (300, 160, 2), (390, 160, 2), (300, 350, 2), (390, 350, 2),
    (490, 160, 3), (570, 160, 3), (490, 350, 3), (570, 350, 3),
    (700, 150, 4), (830, 150, 4), (700, 330, 4), (830, 330, 4),
]

PATCH = 3  # +/-3 px -> 7x7


def read_patch(depth, x, y):
    sub = depth[max(0, y - PATCH):y + PATCH + 1, max(0, x - PATCH):x + PATCH + 1]
    ok = np.isfinite(sub)
    return (float(np.median(sub[ok])), int(ok.sum())) if ok.any() else (float("nan"), 0)


def fit_trimmed(us, vs, z, trims=4, keep_sigma=2.0, min_pix=200):
    us = us.astype(np.float64); vs = vs.astype(np.float64); z = z.astype(np.float64)
    keep = np.ones(z.shape, bool)
    coef = np.array([0.0, 0.0, float(np.median(z))])
    for _ in range(trims):
        if int(keep.sum()) < min_pix:
            break
        A = np.stack([us[keep], vs[keep], np.ones(int(keep.sum()))], axis=1)
        coef, *_ = np.linalg.lstsq(A, z[keep], rcond=None)
        resid = z - np.stack([us, vs, np.ones_like(z)], axis=1) @ coef
        sd = float(np.std(resid[keep]))
        if sd <= 1e-6:
            break
        nk = np.abs(resid) <= keep_sigma * sd
        if int(nk.sum()) < min_pix or int(nk.sum()) == int(keep.sum()):
            break
        keep = nk
    return coef, int(keep.sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--stop", required=True)
    ap.add_argument("--site-map", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--threshold", type=float, default=None)
    args = ap.parse_args()

    p = [x for x in sorted(glob.glob(os.path.join(args.dir, "*_scan_stop*_rgb.jpg")))
         if f"_stop{args.stop}_" in x][0]
    stem = p[: -len("_rgb.jpg")]
    rgb = cv2.imread(p)
    depth = AL.clean_depth(np.load(stem + "_depth.npy"))
    H, W = depth.shape
    print(f"frame: {os.path.basename(p)}")

    m = np.load(args.model)
    Wt, mu, sd = m["W"], m["mu"], m["sd"]
    thr = args.threshold if args.threshold is not None else float(m["threshold"])

    F = features(rgb, depth).reshape(-1, len(FEATURE_NAMES))
    prob = softmax(((F - mu) / sd) @ Wt)[:, 1].reshape(H, W)
    mask = prob >= thr
    print(f"model threshold {thr:.2f} -> {int(mask.sum()):,} channel px "
          f"({100.0*mask.mean():.1f}% of frame)")

    pooled = fit_channel_plane(depth, AL.excess_green(rgb) > 0.14)
    print(f"production pooled fit_channel_plane: {pooled:.1f} mm  (one value for "
          f"every pixel in the frame)\n")

    # site map -> channel column bands, so each channel gets its own plane
    smap = json.load(open(args.site_map))
    sites = smap["sites_per_stop"][str(args.stop)]["sites"]
    bands = {}
    for s in sites:
        ch = int(s["channel"])
        x0, w = s["roi_xywh"][0], s["roi_xywh"][2]
        lo, hi = bands.get(ch, (10**9, -10**9))
        bands[ch] = (min(lo, x0), max(hi, x0 + w))

    vv, uu = np.mgrid[0:H, 0:W]
    planes = {}
    for ch, (x0, x1) in sorted(bands.items()):
        sel = np.zeros((H, W), bool)
        sel[:, x0:x1] = True
        sel &= mask & np.isfinite(depth)
        if int(sel.sum()) < 200:
            print(f"  ch{ch}: only {int(sel.sum())} px -> no fit")
            continue
        coef, nkept = fit_trimmed(uu[sel], vv[sel], depth[sel])
        planes[ch] = coef
        print(f"  ch{ch}: {int(sel.sum()):>6,} masked px, {nkept:>6,} kept after "
              f"trimming, plane tilt a={coef[0]:+.4f} b={coef[1]:+.4f}")

    print(f"\n{'pt':>3} {'x':>5} {'y':>5} {'ch':>3} {'MANUAL mm':>10} {'valid':>6} "
          f"{'MODEL mm':>9} {'diff':>7} {'pooled diff':>12}")
    print("-" * 74)
    diffs, pdiffs = [], []
    for i, (x, y, ch) in enumerate(MANUAL_POINTS, 1):
        man, nok = read_patch(depth, x, y)
        if ch in planes:
            c = planes[ch]
            mod = c[0] * x + c[1] * y + c[2]
            d = mod - man
            diffs.append(d)
        else:
            mod, d = float("nan"), float("nan")
        pd = pooled - man
        pdiffs.append(pd)
        print(f"{i:>3} {x:>5} {y:>5} {ch:>3} {man:>10.1f} {nok:>4}/49 "
              f"{mod:>9.1f} {d:>+7.1f} {pd:>+12.1f}")

    dd = np.array([d for d in diffs if np.isfinite(d)])
    pp = np.array([d for d in pdiffs if np.isfinite(d)])
    print(f"\nMODEL   vs manual: mean {dd.mean():+.1f} mm, "
          f"abs-mean {np.abs(dd).mean():.1f}, worst {np.abs(dd).max():.1f}")
    print(f"POOLED  vs manual: mean {pp.mean():+.1f} mm, "
          f"abs-mean {np.abs(pp).mean():.1f}, worst {np.abs(pp).max():.1f}")
    print("\nPer channel (manual median vs model plane at channel centre):")
    for ch in sorted(bands):
        mans = [read_patch(depth, x, y)[0] for x, y, c in MANUAL_POINTS if c == ch]
        mans = [v for v in mans if np.isfinite(v)]
        if not mans:
            continue
        xm = 0.5 * (bands[ch][0] + bands[ch][1]); ym = H / 2.0
        mod = (planes[ch][0] * xm + planes[ch][1] * ym + planes[ch][2]
               if ch in planes else float("nan"))
        print(f"  ch{ch}: manual {np.median(mans):>6.1f} mm | model {mod:>6.1f} mm "
              f"| pooled {pooled:>6.1f} mm")


if __name__ == "__main__":
    main()
