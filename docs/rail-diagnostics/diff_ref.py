import json, sys, numpy as np
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
la,lb=sys.argv[3],sys.argv[4]
ka,kb=set(a["planes"]),set(b["planes"])
print(f"{la}: {len(ka)} cells   {lb}: {len(kb)} cells   both: {len(ka&kb)}")
if ka-kb: print(f"  only in {la}: {len(ka-kb)} -> {sorted(ka-kb)[:8]}")
if kb-ka: print(f"  only in {lb}: {len(kb-ka)} -> {sorted(kb-ka)[:8]}")
byc={}
for k in sorted(ka&kb):
    st,ch=k.split("|"); d=b["planes"][k]["plane_mm"]-a["planes"][k]["plane_mm"]
    byc.setdefault(int(ch),[]).append((int(st),d))
print(f"\n{'ch':>4} {'n':>4} {'mean diff':>10} {'sd':>7} {'worst':>8}  per-stop diffs")
allv=[]
for ch in sorted(byc):
    v=np.array([d for _,d in byc[ch]]); allv+=list(v)
    ds=" ".join(f"{d:+.0f}" for _,d in sorted(byc[ch]))
    print(f"{ch:>4} {v.size:>4} {v.mean():>+10.2f} {v.std():>7.2f} "
          f"{v[np.argmax(abs(v))]:>+8.2f}  {ds}")
allv=np.array(allv)
print(f"\nALL  {allv.size:>4} {allv.mean():>+10.2f} {allv.std():>7.2f} "
      f"{allv[np.argmax(abs(allv))]:>+8.2f}")
print(f"\nverdict: {'CONSISTENT' if np.abs(allv).max() < 3 else 'DIVERGES — investigate'}"
      f"  (max |diff| {np.abs(allv).max():.2f} mm)")
