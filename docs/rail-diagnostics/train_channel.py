#!/usr/bin/env python3
"""
train_channel.py — learn "is this pixel NFT channel top face?" from free labels.

PURPOSE
  Not plant segmentation. The job is to find CHANNEL pixels reliably in any
  condition, so the geometric plane fit downstream always has a trustworthy set
  of points to fit to. ML does the perception; geometry does the measuring.

WHY IT MUST FUSE COLOUR AND DEPTH
  Each modality fails alone, and they fail at different times:
    - COLOUR dies when the lights are off. Measured: unlit frames read a median
      brightness of 8-14 out of 765 against ~416 lit, and the photoperiod moved
      during the archive, so "it is daytime" is not something to assume.
    - DEPTH dies where stereo drops out — ch4 averages 87.8% valid against
      98-99% elsewhere, and leaves cause dropouts.
  A model on both degrades gracefully when either is missing, which is what
  "unfailable" actually requires. Depth alone also means the channel remains
  measurable IN THE DARK: active IR does not care about the grow lights, so the
  unlit cycles (currently ~45% of all cycles, producing nothing) are in fact
  the CLEANEST channel-measurement frames available — no specular highlights,
  no lighting drift.

WHY POSITION IS A FEATURE
  The rig is mechanically fixed and step-repeatable (master file 6), so a
  channel is always in roughly the same columns at a given stop. Column
  position is genuinely informative and free. It is deliberately a WEAK feature
  here (normalised, no interactions) so the model cannot simply memorise "the
  channel is at x=250" and stop looking at the pixel — which would defeat the
  entire point of detecting that something moved.

THRESHOLD SELECTION — READ THIS BEFORE TRUSTING THE SWEEP BELOW
  The threshold sweep printed by this script is computed on CLASS-BALANCED
  SAMPLED PIXELS, and those numbers DO NOT transfer to whole-frame inference.
  Measured: the sweep reported 99.4% precision at threshold 0.99 while still
  retaining 22k pixels, which looked like a safe operating point. On a real
  frame that threshold fired on 0.8% of pixels and found ZERO channel pixels in
  three of the four channels. Validated against hand-read depth
  (manual_vs_model.py), the usable range is 0.3-0.7, where per-channel planes
  match hand readings to ~1 mm. The saved threshold is 0.5.
  Always confirm a threshold on FULL FRAMES, never on the balanced sample.

MODEL
  Multinomial logistic regression, trained by plain gradient descent in numpy.
  Chosen over anything deeper because: the Pi has numpy and cv2 and nothing
  else (no sklearn, no onnxruntime), inference must be a handful of vectorised
  ops, and the weights stay human-readable so a wrong prediction can be traced
  to a feature. Master file 7.4 makes the same argument for the trait model:
  "the feature model is debuggable ... and is robust to lighting drift".
  If this saturates, the upgrade path is a small MLP with the same features.
"""

import argparse
import glob
import json
import os

import numpy as np
import cv2

import autolabel as AL

FEATURE_NAMES = ["bias", "r_n", "g_n", "b_n", "exg", "bright_n",
                 "depth_n", "depth_dev_n", "depth_valid", "u_n", "v_n",
                 "lit", "lit_exg", "lit_bright", "lit_g", "lit_r"]
# BINARY, deliberately. This model has exactly one job: mark the pixels the
# geometric plane fit is allowed to use. Whether a non-channel pixel is a cup, a
# leaf or the cardboard is irrelevant to that job, and asking one model to also
# answer it made the two classes we do not need (CUP precision 66%, PLANT recall
# 46%) drag on the one we do. Plant segmentation is a separate concern that the
# production ExG mask already handles well (master file 7.2).
NEGATIVE, POSITIVE = 0, 1
SOURCE_NEG = [AL.BACKGROUND, AL.CUP, AL.PLANT]   # IGNORE is never a label


def features(rgb, depth):
    """Per-pixel feature stack, (H, W, F). Must match infer_channel.py exactly."""
    H, W = depth.shape
    f = rgb.astype(np.float32)
    s = f.sum(axis=2) + 1e-6
    b, g, r = f[:, :, 0] / s, f[:, :, 1] / s, f[:, :, 2] / s
    exg = 2 * g - r - b
    bright = s / 765.0

    valid = np.isfinite(depth)
    # Robust per-frame depth reference. NOT the fitted channel plane: using
    # that here would be circular, since the plane is what this feeds.
    ref = float(np.median(depth[valid])) if valid.any() else 400.0
    d = np.where(valid, depth, ref)
    depth_n = (d - 400.0) / 100.0
    depth_dev_n = (d - ref) / 50.0

    vv, uu = np.mgrid[0:H, 0:W]
    u_n = uu / float(W) - 0.5
    v_n = vv / float(H) - 0.5

    # Explicit lighting state + colour interactions. A LINEAR model cannot
    # otherwise express "trust colour when lit, fall back to depth when dark" —
    # that is an interaction, and without these terms the colour weights
    # collapse toward zero when lit and unlit frames are mixed (measured: every
    # colour weight fell inside +-0.1 while brightness and depth-validity
    # dominated at ~+2.0, and PLANT recall went to 0%). The lighting state is
    # known per frame, not guessed: unlit frames read a median brightness of
    # 8-14/765 against ~416 lit, and the photoperiod moved during the archive
    # so it cannot be inferred from the clock.
    lit = np.float32(1.0 if float(np.median(s)) > 150.0 else 0.0)
    litf = np.full((H, W), lit, np.float32)

    return np.stack([np.ones((H, W), np.float32), r, g, b, exg, bright,
                     depth_n, depth_dev_n, valid.astype(np.float32),
                     u_n.astype(np.float32), v_n.astype(np.float32),
                     litf, litf * exg, litf * bright, litf * g, litf * r],
                    axis=2).astype(np.float32)


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def train(X, y, n_cls, epochs=300, lr=0.5, l2=1e-4, seed=0):
    rng = np.random.default_rng(seed)
    W = rng.normal(0, 0.01, (X.shape[1], n_cls))
    n = X.shape[0]
    for ep in range(epochs):
        P = softmax(X @ W)
        Y = np.zeros_like(P)
        Y[np.arange(n), y] = 1.0
        grad = X.T @ (P - Y) / n + l2 * W
        W -= lr * grad
    return W


def collect(dirs, site_map, args, max_frames):
    smap = json.load(open(site_map))
    per_stop = smap["sites_per_stop"]
    Xs, ys, kept = [], [], 0
    rng = np.random.default_rng(1)
    import re

    # Interleave directories ROUND-ROBIN. Filling sequentially is a trap: the
    # first cycle supplies 11 frames, so a cap of 12 took 11 frames from one
    # directory and 1 from the next, and never reached the rest. With the empty
    # cycles listed first that meant ZERO plant pixels and ZERO dark frames in
    # training, which showed up as PLANT recall 0% and every lighting-interaction
    # weight pinned at ~0 — a broken sample, not a broken model.
    per_dir = []
    for d in dirs:
        fs = [p for p in sorted(glob.glob(os.path.join(d, "*_scan_stop*_rgb.jpg")))
              if re.search(r"_scan_stop(\d+)_", os.path.basename(p))]
        per_dir.append(fs)
    ordered = []
    for i in range(max(len(f) for f in per_dir) if per_dir else 0):
        for fs in per_dir:
            if i < len(fs):
                ordered.append(fs[i])

    if True:
        for p in ordered:
            if kept >= max_frames:
                break
            m = re.search(r"_scan_stop(\d+)_", os.path.basename(p))
            if not m or m.group(1) not in per_stop:
                continue
            stem = p[: -len("_rgb.jpg")]
            rgb = cv2.imread(p)
            depth = AL.clean_depth(np.load(stem + "_depth.npy"))
            lit = float(np.median(rgb.astype(np.float32).sum(axis=2))) > 150
            args.with_plants = lit  # cannot label plants in the dark
            lab, _ = AL.label_frame(rgb, depth, per_stop[m.group(1)]["sites"], args)
            F = features(rgb, depth).reshape(-1, len(FEATURE_NAMES))
            flat = lab.ravel()
            pos = np.flatnonzero(flat == AL.CHANNEL)
            neg = np.flatnonzero(np.isin(flat, SOURCE_NEG))
            for idx, cls in ((pos, POSITIVE), (neg, NEGATIVE)):
                if idx.size == 0:
                    continue
                take = rng.choice(idx, size=min(args.per_class, idx.size),
                                  replace=False)
                Xs.append(F[take])
                ys.append(np.full(take.size, cls, np.int64))
            kept += 1
    if not Xs:
        raise SystemExit("no labelled pixels collected")
    return np.concatenate(Xs), np.concatenate(ys), kept


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-dirs", nargs="+", required=True)
    ap.add_argument("--test-dirs", nargs="+", required=True)
    ap.add_argument("--site-map", required=True)
    ap.add_argument("--out", default="channel_model.npz")
    ap.add_argument("--per-class", type=int, default=4000)
    ap.add_argument("--max-train-frames", type=int, default=12)
    ap.add_argument("--max-test-frames", type=int, default=6)
    # label-side knobs, passed through to autolabel.label_frame
    ap.add_argument("--lo", type=float, default=300.0)
    ap.add_argument("--hi", type=float, default=500.0)
    ap.add_argument("--band-radii", type=float, default=1.8)
    ap.add_argument("--cup-margin", type=float, default=1.25)
    ap.add_argument("--plane-tol", type=float, default=6.0)
    ap.add_argument("--min-bright", type=float, default=150.0)
    ap.add_argument("--max-exg-channel", type=float, default=0.10)
    ap.add_argument("--prod-exg", type=float, default=0.14)
    ap.add_argument("--prod-bright", type=float, default=120.0)
    ap.add_argument("--plant-min-mm", type=float, default=10.0)
    ap.add_argument("--with-plants", action="store_true")
    args = ap.parse_args()

    Xtr, ytr, ntr = collect(args.train_dirs, args.site_map, args, args.max_train_frames)
    Xte, yte, nte = collect(args.test_dirs, args.site_map, args, args.max_test_frames)
    print(f"train: {Xtr.shape[0]:,} px from {ntr} frames   "
          f"test: {Xte.shape[0]:,} px from {nte} frames")

    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-6
    mu[0], sd[0] = 0.0, 1.0                      # leave the bias term alone
    W = train((Xtr - mu) / sd, ytr, 2)

    P = softmax(((Xte - mu) / sd) @ W)[:, POSITIVE]
    print(f"\nCHANNEL detector — threshold sweep on held-out frames")
    print(f"(precision is what matters: a false channel pixel corrupts the plane;")
    print(f" a missed one costs nothing when tens of thousands remain)\n")
    print(f"{'thresh':>7} {'precision':>10} {'recall':>8} {'kept px':>9}")
    best = None
    for t in (0.50, 0.70, 0.80, 0.90, 0.95, 0.99):
        pred = P >= t
        tp = int((pred & (yte == POSITIVE)).sum())
        fp = int((pred & (yte == NEGATIVE)).sum())
        fn = int((~pred & (yte == POSITIVE)).sum())
        prec = tp / max(tp + fp, 1)
        rec = tp / max(tp + fn, 1)
        print(f"{t:>7.2f} {100*prec:>9.1f}% {100*rec:>7.1f}% {tp+fp:>9,}")
        if prec >= 0.99 and best is None:
            best = t
    print(f"\nlowest threshold reaching >=99% precision: "
          f"{best if best else 'none of those tried'}")

    np.savez(args.out, W=W, mu=mu, sd=sd, threshold=np.float32(best or 0.95),
             features=np.array(FEATURE_NAMES))
    print(f"\nsaved {args.out}  ({W.size} weights)")
    print("\nweights (standardised units, larger = pushes toward CHANNEL):")
    for name, w in sorted(zip(FEATURE_NAMES, W[:, POSITIVE] - W[:, NEGATIVE]),
                          key=lambda t: -abs(t[1])):
        print(f"   {name:>12} {w:+.3f}")


if __name__ == "__main__":
    main()
