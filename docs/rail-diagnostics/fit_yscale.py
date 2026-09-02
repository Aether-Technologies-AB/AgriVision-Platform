"""Fit ONE scalar y_scale that minimises cross-view disagreement in world Y.

Model: Yw = direction*(MM_PER_STEP*P) - direction*(y_scale * Ycam)
Correct registration => the same pot's Yw agrees across its 3 views.
Objective: total variance of per-view median Yw, summed over pots.
Read-only: fits and reports, changes nothing.
"""
import argparse, glob, json, os
from collections import defaultdict
import numpy as np, cv2
import gates
from merge_views import parse_capture, segment, MM_PER_STEP
from measure_plants import clean_depth, fit_channel_plane

ap = argparse.ArgumentParser(); ap.add_argument("--dir", required=True)
ap.add_argument("--site-map", required=True); ap.add_argument("--row-direction", type=int, default=1)
gates.add_gate_args(ap); a = ap.parse_args()
smap = json.load(open(a.site_map)); per_stop = smap["sites_per_stop"]

# collect (site, angle) -> (median Ycam, median P) so the fit is cheap
obs = defaultdict(dict)
for p in sorted(glob.glob(os.path.join(a.dir, "*_scan_stop*_rgb.jpg"))):
    si, P = parse_capture(p)
    if si is None or str(si) not in per_stop: continue
    base = p[:-len("_rgb.jpg")]
    rgb = cv2.imread(p); depth = clean_depth(np.load(base+"_depth.npy"))
    intr = json.load(open(base+"_intrinsics.json"))
    mask, exg = segment(rgb, a.exg, a.min_brightness)
    plane = fit_channel_plane(depth, mask)
    if not np.isfinite(plane): continue
    fy, cy = float(intr["fy"]), float(intr["cy"])
    for s in per_stop[str(si)]["sites"]:
        x, y, w, h = s["roi_xywh"]; sub = mask[y:y+h, x:x+w]
        if sub.sum() < a.min_area: continue
        e = exg[y:y+h, x:x+w][sub]
        if e.size and float((e>gates.DEEP_GREEN_EXG).mean()) < a.min_deep_green: continue
        vs, us = np.where(sub)
        z = depth[vs+y, us+x]; ok = np.isfinite(z)
        if ok.sum() == 0: continue
        Ycam = ((vs+y)[ok] - cy) * z[ok] / fy
        obs[s["site_id"]][float(s["view_angle_deg"])] = (float(np.median(Ycam)), P)

pots = {s: v for s, v in obs.items() if len(v) >= 3}
def cost(scale):
    tot = 0.0
    for v in pots.values():
        yws = [a.row_direction*(MM_PER_STEP*P) - a.row_direction*(scale*Yc)
               for (Yc, P) in v.values()]
        tot += float(np.var(yws))
    return tot / max(len(pots), 1)

grid = np.arange(0.80, 1.31, 0.002)
costs = [cost(s) for s in grid]
best = float(grid[int(np.argmin(costs))])
print(f"pots with 3 views: {len(pots)}")
print(f"current  y_scale=1.000 -> mean per-pot Yw variance {cost(1.0):9.1f} mm^2 "
      f"(sd {np.sqrt(cost(1.0)):.1f} mm)")
print(f"fitted   y_scale={best:.3f} -> mean per-pot Yw variance {cost(best):9.1f} mm^2 "
      f"(sd {np.sqrt(cost(best)):.1f} mm)")
print(f"\nimplied correction: {100*(best-1):+.1f}%  "
      f"(equivalently fy should be {1/best:.4f}x its reported value)")
