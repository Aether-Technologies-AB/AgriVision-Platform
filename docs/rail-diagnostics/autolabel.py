#!/usr/bin/env python3
"""
autolabel.py — build training labels for a channel segmenter, for free.

WHY THIS IS POSSIBLE WITHOUT ANNOTATION
  The rig is mechanically fixed and step-repeatable, so the site map already
  knows every cup's centre and radius at every stop (master file section 6).
  Floor 1 additionally sat EMPTY from 2026-07-20 to 2026-08-23 with depth
  retained, so on those cycles every pixel is known to be non-plant. Between
  the two, channel / cup / background can be labelled geometrically, and plant
  can be labelled on planted cycles from the production ExG mask.

  BUT PICK THE EMPTY CYCLES CAREFULLY — most of them are UNLIT. With no crop in
  the trays the grow lights were off, so frames from 2026-08-22 and 08-23 read a
  median brightness of 8-14 out of 765 (lit channels read ~416). Depth still
  works in the dark, being active IR, but no COLOUR feature can be learned from
  them. Verified-lit AND empty cycles do exist: 2026-08-10 (04/08/12/16h) and
  2026-08-16 (04/08/12h). Check median frame brightness > 150 before using a
  cycle, do not assume from the clock.

  RELATEDLY, the photoperiod MOVED. Hour 04 was lit on 08-10 and 08-16 but dark
  by 08-24; hour 16 was lit on 08-10, dark on 08-16, lit again on 08-24. Any
  rule of the form "hours 6-19 are daytime" is therefore wrong for some part of
  the archive. Gate on measured brightness, never on the hour.

WHAT IT IS FOR
  The plane fit needs to know which pixels are CHANNEL TOP FACE. Today that is
  decided by `exg > 0.14 AND brightness > 120` — two hand-set numbers, and
  section 5.14 is the record of how brittle that is (adding black cups silently
  invalidated the colour tuning for 40 hours). A fitted per-pixel model on
  colour + depth features replaces the guessing. Geometry then does the
  measuring, which needs no learning.

CLASSES
  0 BACKGROUND  cardboard / off-rig: no valid depth, or far beyond the channel
                (section 5.5: the cardboard returns no depth at all)
  1 CHANNEL     the trough top face — planar, near the fitted per-channel plane
  2 CUP         inside a known net-pot circle
  3 PLANT       high-confidence vegetation (planted cycles only)
  255 IGNORE    ambiguous; deliberately NOT given a label rather than guessed

Labels are written as a PNG mask plus an optional colour overlay for eyeballing.
Read-only with respect to the pipeline; writes only to --out-dir.
"""

import argparse
import glob
import json
import os
from collections import defaultdict

import numpy as np
import cv2

BACKGROUND, CHANNEL, CUP, PLANT, IGNORE = 0, 1, 2, 3, 255

PALETTE = {
    BACKGROUND: (60, 60, 60),
    CHANNEL: (255, 200, 0),      # BGR: cyan-ish/orange -> channel
    CUP: (255, 0, 255),
    PLANT: (0, 255, 0),
    IGNORE: (0, 0, 0),
}


def excess_green(bgr):
    """Same definition the pipeline uses: 2g - r - b on S-normalised channels."""
    f = bgr.astype(np.float32)
    s = f.sum(axis=2) + 1e-6
    b, g, r = f[:, :, 0] / s, f[:, :, 1] / s, f[:, :, 2] / s
    return 2 * g - r - b


def clean_depth(d):
    d = d.astype(np.float32)
    d[d == 0] = np.nan
    d[d >= 65535] = np.nan
    return d


def fit_plane_trimmed(us, vs, z, trims=4, keep_sigma=2.0, min_pix=400):
    """Iteratively trimmed least squares. Plain LSQ is dragged off the top face
    by cardboard and trough walls (measured: 13-24 mm residuals)."""
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
    return coef


def label_frame(rgb, depth, sites, args):
    H, W = depth.shape
    lab = np.full((H, W), IGNORE, np.uint8)
    vv, uu = np.mgrid[0:H, 0:W]
    exg = excess_green(rgb)
    bright = rgb.astype(np.float32).sum(axis=2)
    valid = np.isfinite(depth)

    by_ch = defaultdict(list)
    cups = np.zeros((H, W), bool)
    cups_wide = np.zeros((H, W), bool)
    for s in sites:
        by_ch[int(s["channel"])].append(s)
        if s.get("r"):
            c = (int(s["cx"]), int(s["cy"]))
            r = float(s["r"])
            m = np.zeros((H, W), np.uint8)
            cv2.circle(m, c, int(round(r)), 1, -1)
            cups |= m.astype(bool)
            m2 = np.zeros((H, W), np.uint8)
            cv2.circle(m2, c, int(round(r * args.cup_margin)), 1, -1)
            cups_wide |= m2.astype(bool)

    # ---- BACKGROUND: no depth at all. The cardboard reads black (5.5), which
    # makes it self-labelling; this is the one class we get almost for free.
    lab[~valid] = BACKGROUND

    # ---- per channel: fit the top face, then label near-plane pixels CHANNEL
    planes = {}
    for ch, ss in sorted(by_ch.items()):
        centre = float(np.median([float(s["cx"]) for s in ss]))
        rs = [float(s["r"]) for s in ss if s.get("r")]
        half = (np.median(rs) if rs else 38.0) * args.band_radii
        x0, x1 = max(0, int(centre - half)), min(W, int(centre + half))
        band = np.zeros((H, W), bool)
        band[:, x0:x1] = True

        seed = band & valid & (~cups_wide) & (depth >= args.lo) & (depth <= args.hi)
        if int(seed.sum()) < 400:
            continue
        coef = fit_plane_trimmed(uu[seed], vv[seed], depth[seed])
        planes[ch] = coef
        pred = coef[0] * uu + coef[1] * vv + coef[2]
        resid = depth - pred

        near = band & valid & (~cups_wide) & (np.abs(resid) <= args.plane_tol)
        # colour sanity: the trough is white PVC, so channel pixels must be
        # bright and NOT green. Keeps a stray leaf out of the CHANNEL class.
        near &= (bright > args.min_bright) & (exg < args.max_exg_channel)
        lab[near] = CHANNEL

        far = band & valid & (resid > args.plane_tol * 3)
        lab[far & (lab == IGNORE)] = BACKGROUND

    # ---- CUP: inside a known circle. Overwrites channel, since the cup sits in
    # the hole and its rim protrudes above the top face.
    lab[cups] = CUP

    # ---- PLANT: only high-confidence vegetation, and only where it protrudes.
    # Deliberately conservative: precision matters far more than recall for a
    # training label. Ambiguous vegetation stays IGNORE.
    if args.with_plants:
        # Use the PRODUCTION ExG mask, not thresholds invented here. Measured on
        # a real planted frame: leaf brightness is p10/p50/p90 = 130/186/284, so
        # an invented `bright > 200` floor discarded 62% of genuine leaf pixels
        # and `exg > 0.25` discarded 41% — together they labelled only 1.6% of
        # the frame as plant while the rosettes were plainly visible. That is
        # the exact failure mode section 5.14 documents: hand-set numbers that
        # do not match the rig. segment() is the pipeline's own tuned mask and
        # section 7.2 reports it "hugs frilly leaf edges with no bleed".
        from merge_views import segment as _prod_segment
        prod_mask, _ = _prod_segment(rgb, args.prod_exg, args.prod_bright)

        # Still require protrusion, for section 7.2b's reason: a green cast on
        # something flat (channel lip, tent) is not a plant. Plants protrude.
        prot = np.zeros((H, W), bool)
        for ch, coef in planes.items():
            pred = coef[0] * uu + coef[1] * vv + coef[2]
            prot |= valid & ((pred - depth) >= args.plant_min_mm)

        plant = prod_mask & prot
        plant = cv2.morphologyEx(plant.astype(np.uint8), cv2.MORPH_OPEN,
                                 np.ones((5, 5), np.uint8)).astype(bool)
        lab[plant] = PLANT

        # Anything the production mask calls vegetation but that does NOT
        # protrude is genuinely ambiguous -> IGNORE, never a training label.
        lab[prod_mask & (~plant)] = IGNORE

        # A cup with a plant growing out of it is mostly PLANT, not CUP: the
        # rosette crown sits in the hole. Asserting CUP there would teach the
        # model that leaf tissue is cup. Where vegetation overlaps a known cup
        # circle and did not qualify as PLANT, the pixel is ambiguous -> IGNORE.
        lab[cups & prod_mask & (lab == CUP)] = IGNORE

    return lab, planes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--site-map", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--stops", default="")
    ap.add_argument("--with-plants", action="store_true",
                    help="also label PLANT (use on planted cycles)")
    ap.add_argument("--overlay", action="store_true", help="write colour overlays")
    ap.add_argument("--lo", type=float, default=300.0)
    ap.add_argument("--hi", type=float, default=500.0)
    ap.add_argument("--band-radii", type=float, default=1.8)
    ap.add_argument("--cup-margin", type=float, default=1.25)
    ap.add_argument("--plane-tol", type=float, default=6.0)
    ap.add_argument("--min-bright", type=float, default=150.0)
    ap.add_argument("--max-exg-channel", type=float, default=0.10)
    ap.add_argument("--prod-exg", type=float, default=0.14,
                    help="production ExG threshold (segment() default)")
    ap.add_argument("--prod-bright", type=float, default=120.0,
                    help="production brightness floor (segment() default)")
    ap.add_argument("--plant-min-mm", type=float, default=10.0)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    smap = json.load(open(args.site_map))
    per_stop = smap["sites_per_stop"]
    want = {s.strip() for s in args.stops.split(",") if s.strip()}

    tally = defaultdict(int)
    n = 0
    for p in sorted(glob.glob(os.path.join(args.dir, "*_scan_stop*_rgb.jpg"))):
        base = os.path.basename(p)
        import re
        m = re.search(r"_scan_stop(\d+)_", base)
        if not m:
            continue
        si = m.group(1)
        if si not in per_stop or (want and si not in want):
            continue
        stem = p[: -len("_rgb.jpg")]
        rgb = cv2.imread(p)
        depth = clean_depth(np.load(stem + "_depth.npy"))
        lab, planes = label_frame(rgb, depth, per_stop[si]["sites"], args)

        out = os.path.join(args.out_dir, os.path.basename(stem) + "_label.png")
        cv2.imwrite(out, lab)
        if args.overlay:
            ov = rgb.copy()
            for k, col in PALETTE.items():
                if k == IGNORE:
                    continue
                ov[lab == k] = (0.45 * np.array(col) + 0.55 * ov[lab == k]).astype(np.uint8)
            cv2.imwrite(os.path.join(args.out_dir,
                                     os.path.basename(stem) + "_overlay.jpg"), ov,
                        [cv2.IMWRITE_JPEG_QUALITY, 90])
        for k in (BACKGROUND, CHANNEL, CUP, PLANT, IGNORE):
            tally[k] += int((lab == k).sum())
        n += 1

    total = sum(tally.values()) or 1
    print(f"labelled {n} frames -> {args.out_dir}")
    names = {BACKGROUND: "BACKGROUND", CHANNEL: "CHANNEL", CUP: "CUP",
             PLANT: "PLANT", IGNORE: "IGNORE"}
    for k in (BACKGROUND, CHANNEL, CUP, PLANT, IGNORE):
        print(f"  {names[k]:>11} {tally[k]:>12,}  {100.0*tally[k]/total:>5.1f}%")


if __name__ == "__main__":
    main()
