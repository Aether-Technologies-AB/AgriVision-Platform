"""Per-channel channel-surface depth, measured only inside the net-pot ROIs.

Robust version: for every site ROI, take NON-plant pixels with a physically
plausible depth (300-500 mm, which excludes the cardboard backing behind the
channels and near-camera noise), and take the median. One value per site.
Then summarise per channel. This never mixes channels and never sees the
inter-channel gaps, which is what broke the column-slice version.
"""
import argparse, glob, json, os
from collections import defaultdict
import numpy as np, cv2
import gates
from merge_views import parse_capture, segment
from measure_plants import clean_depth, fit_channel_plane

ap = argparse.ArgumentParser(); ap.add_argument("--dir", required=True)
ap.add_argument("--site-map", required=True)
ap.add_argument("--lo", type=float, default=300.0); ap.add_argument("--hi", type=float, default=500.0)
gates.add_gate_args(ap); a = ap.parse_args()
smap = json.load(open(a.site_map)); per_stop = smap["sites_per_stop"]

per_ch = defaultdict(list); pooled_all = []; per_ch_stop = defaultdict(dict)
for p in sorted(glob.glob(os.path.join(a.dir, "*_scan_stop*_rgb.jpg"))):
    si, _ = parse_capture(p)
    if si is None or str(si) not in per_stop: continue
    base = p[:-len("_rgb.jpg")]
    rgb = cv2.imread(p); depth = clean_depth(np.load(base+"_depth.npy"))
    mask, _ = segment(rgb, a.exg, a.min_brightness)
    pooled = fit_channel_plane(depth, mask)
    if not np.isfinite(pooled): continue
    pooled_all.append(pooled)
    tmp = defaultdict(list)
    for s in per_stop[str(si)]["sites"]:
        x, y, w, h = s["roi_xywh"]
        d = depth[y:y+h, x:x+w]; m = mask[y:y+h, x:x+w]
        sel = (~m) & np.isfinite(d) & (d >= a.lo) & (d <= a.hi)
        if sel.sum() < 300: continue
        v = float(np.median(d[sel]))
        per_ch[int(s["channel"])].append(v - pooled)
        tmp[int(s["channel"])].append(v)
    for ch, vals in tmp.items():
        per_ch_stop[si][ch] = float(np.median(vals))

chans = sorted(per_ch)
print("per-stop channel-surface depth, measured inside the net-pot ROIs (mm)\n")
print(f"{'stop':>5} {'pooled':>8} " + " ".join(f"{'ch'+str(c):>8}" for c in chans))
print("-"*(15+9*len(chans)))
for si in sorted(per_ch_stop):
    row = " ".join((f"{per_ch_stop[si][c]:>8.1f}" if c in per_ch_stop[si] else f"{'-':>8}") for c in chans)
    print(f"{si:>5} {pooled_all[sorted(per_ch_stop).index(si)]:>8.1f} {row}")

print(f"\n{'channel':>8} {'n_sites':>8} {'median offset':>14} {'IQR':>8} {'% of 25mm plant':>17}")
for c in chans:
    d = np.array(per_ch[c])
    q1, q3 = np.percentile(d, [25, 75])
    print(f"{c:>8} {d.size:>8} {np.median(d):>+14.1f} {q3-q1:>8.1f} {abs(np.median(d))/25*100:>16.0f}%")
meds = [np.median(per_ch[c]) for c in chans]
print(f"\nspread across channels: {max(meds)-min(meds):.1f} mm "
      f"({(max(meds)-min(meds))/25*100:.0f}% of a 25 mm plant)")
