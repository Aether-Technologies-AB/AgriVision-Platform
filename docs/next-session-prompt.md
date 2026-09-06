# Handoff prompt — rail geometry / per-pot distance

Paste the block below into a fresh Claude Code session. It assumes zero prior
context. Swap the **Objective** section for whichever task you want.

---

## The prompt

```
I'm continuing an investigation into the AgriVision camera-rail trait pipeline.
Read docs/robust-pot-distance.md in /Users/giancarloperez/agrivision-platform
FIRST — it is the entry point and explains why this work exists. Then
docs/rail-pipeline-todo.md for open items and the traps already found.

Treat prior findings as claims to verify, not facts. The last session made
several confident statements that turned out wrong, and caught them only by
testing. Re-measure anything load-bearing before you build on it.

ENVIRONMENT — these took a long time to discover, don't rediscover them:

- Platform repo: /Users/giancarloperez/agrivision-platform (Next.js + Prisma,
  Neon Postgres), on `main`, everything merged as of 2026-09-06.
- `npm run build` fails out of the box: lightningcss.darwin-arm64.node is not
  installed. `npm install lightningcss-darwin-arm64 --no-save` fixes it. This is
  a broken install, not your change.
- The DB is reachable from the Mac. There is no psql and the Mac has no numpy.
  Use node + the project's own pg:
    node -e '...' with require("/Users/giancarloperez/agrivision-platform/node_modules/pg")
    connection string from .env.local (DATABASE_URL), ssl:{rejectUnauthorized:false}
- The trait producer does NOT run on pop-os. Older docs say "off-platform GPU
  box" — that is stale. pop-os holds a copy last touched 2026-07-17, runs
  nothing, and is frequently offline (it was offline 25 days at one point).
- Live producer runs on the rail Pis:
    pi4-004 = rail1 = Floor 1 = lettuce
    pi4-005 = rail2 = Floor 2 = basil
    ~/agrivision-edge/nodes/pilot-basement/piN-rail/agrivision/
- SSH user is the hostname itself: `ssh pi4-004@pi4-004`. Not your own username.
- The Pis have numpy + cv2 ONLY. No sklearn, no scipy, no onnxruntime. 4 cores,
  3.8 GB RAM. Anything that must run there has to work in pure numpy.
- The Pis' git remote is a READ-ONLY deploy key (verified: `git push --dry-run`
  returns "the key you are authenticating with has been marked as read only").
  A commit made ON a Pi cannot be pushed from it, and `git reset --hard
  origin/main` will destroy it.
- BUT there IS a push path from the Mac, and it is not obvious: the edge repo is
  cloned at ~/Agrivision-PI/agrivision-farm-nodes (note the SUBDIRECTORY —
  ~/Agrivision-PI itself is not a repo) over HTTPS with osxkeychain
  credentials. It pushes fine. There is no `gh` CLI, but the stored credential
  is a `gho_` token that works against api.github.com for opening PRs.
- deploy/update.sh DOES NOT WORK on the rail nodes: no systemd unit, no .venv,
  so it aborts at the pip line under `set -e`. The rails run from cron with
  /usr/bin/python3. Deploying is:
      cd ~/agrivision-edge && git fetch --all && git reset --hard origin/main
  No restart needed — cron spawns a fresh process each cycle.
- Diagnostics live in docs/rail-diagnostics/. They import merge_views,
  measure_plants and gates, so copy them INTO the Pi's agrivision/ directory to
  run, then delete them — leave the production tree clean.
- Per-cycle capture archive: ~/agrivision-edge/.../agrivision/cycles/ on each
  Pi, depth .npy back to 2026-07-20 (~217 cycles on rail1 and counting).
- The cycle DIRECTORY name is the pipeline run time; the `cycleId` in the DB is
  the FIRST FRAME's timestamp. They differ by ~3 minutes and are not
  interchangeable — `cycles/2026-09-06_15-04-03` holds cycleId
  `2026-09-06_15-01-10`.
- Both Pis hold the FULL repo including the OTHER rail's directory, so
  `ls -d .../*/agrivision | head -1` picks the wrong one. Always name the rail
  explicitly.

GROUND TRUTH — the only numbers no algorithm chose. rail1, stop 6, hand-read
from a gridded frame, 7x7 median, all 49/49 valid:
    ch1 404.5 · ch2 397.5 · ch3 394.5 · ch4 398.5 mm
Any method that disagrees with these by more than ~2 mm is wrong.
docs/rail-diagnostics/manual_vs_model.py is the harness.

METHOD WARNINGS — each of these already cost a wrong conclusion:

1. Balanced-sample metrics do NOT transfer to whole frames. A classifier
   reported 99.4% precision on sampled pixels and then found zero channel
   pixels in three of four channels on a real frame. Always validate on full
   frames.
2. Never use unlit frames for geometry. They read 30-48 mm off. Gate on
   measured median frame brightness > 150, never on the hour — the photoperiod
   MOVED during the archive (hour 04 lit on 2026-08-10, dark by 08-24).
3. The site map's ROI is NOT the channel band. It tiles half-way to the
   neighbouring hole, so ~17% of it is inter-channel gap. Using it as a plane
   band made one channel read 443 mm at six stops and 398 mm at five.
4. Plant contamination looks exactly like rig drift — both read nearer. An
   apparent 7.7 mm drift collapsed to 0.1 mm once the leaf mask was dilated.
   Dilate the plant mask (>=5) before concluding anything moved, and don't set
   a drift threshold tighter than ~5 mm.
5. Plain least squares on channel pixels fails (13-24 mm residuals, tilts to
   -11.6 deg) — the cardboard and trough walls drag it. Use the median-seeded
   fit in build_plane_ref.py.
6. An absolute brightness floor is not enough. A frame can pass `> 150` and
   still be shadowed: 2026-08-16_12-04-05 has stops 9/10/11 at 292/180/268
   against that cycle's own median of 413, and under frozen bands it produced a
   62 mm error. Gate RELATIVE to the cycle too (SHADOW_FRAC in
   build_plane_ref.py).
7. Do not derive a site's identity from what was DETECTED. Which cell and which
   stop a site belongs to are properties of the site map. Three separate bugs
   came from this: merge_views lost row11_ch4's cell because its nadir view
   failed a colour gate, measure_cycle left 19 of 132 records on the pooled
   plane, and the dashboard counted 1-view "fusions" of sites not in the nadir
   map at all.

DO NOT REDO — tried, measured, rejected, with reasons in section 5 of
robust-pot-distance.md: per-cycle channel detection (silently loses a whole
channel on rail2); width-based bridging of plant-fragmented runs (welds two
channels into one); dark frames; a learned segmenter in the critical path
(works, 1.0 mm, but cannot beat its own labels and fails silently); public
plant-segmentation models (none of them knows what an NFT trough is).

OBJECTIVE

<pick one — see the options list below this block>

Work in small verified steps. Prefer measuring over reasoning. Tell me plainly
when a prior claim of mine does not hold up.
```

---

## Objective options — paste one into the `OBJECTIVE` slot

**A · Calibrate and validate rail2 (highest value)**
```
Build the per-(stop, channel) plane reference for rail2 and validate it the
same way rail1 was: pick ~16 channel points by eye from a gridded frame, read
raw depth by hand, and compare. rail2 is where the plane error actually bites —
its ch1 sits 27 mm off the pooled plane against an 8 mm presence gate, which is
what §7.2b misattributed to a shelf — and its reference is currently
unvalidated. Note rail2 needs frames that are lit AND its channels span ~30 mm,
which broke the old detector. Report whether the frozen-band approach holds
there or needs different parameters.
```

**B · Implement Step 2 (runtime use of the reference)**
```
Implement Step 2 from docs/robust-pot-distance.md: have the producer read the
frozen per-(stop, channel) reference instead of re-deriving the plane, verify
it against a dilated plant mask each cycle, flag drift beyond ~5 mm, and record
which source each record used. Mark degenerate cells unusable first —
ch4/stop 1 on rail1 currently returns -47 mm from too few pixels. Bump the
record `schema` so the discontinuity is visible in the DB. Do not deploy; leave
it committed for review.
```

**C · Close the metric-scale question**
```
Three independent methods say the rig under-measures by 8% (rail1) and 15%
(rail2): a cross-view registration fit, a within-frame row-spacing check, and
net-pot diameter measured against the site map's stored Hough radii. All are
camera-internal, so one external length is needed to close it. Confirm the
net-pot spec diameter (if they are 50 mm, measured/spec = 0.909 on rail1), then
work out what it implies for areaCm2, canopyVolumeCm3 and any harvest
calibration fitted before the fix. Note Kim et al. 2024 worked in dimensionless
pixels, so a constant scale error is absorbed by a per-rail fit — quantify
where it does and does not matter.
```

**D · Audit what I concluded about Floor 1 lettuce**
```
Independently re-derive the Floor 1 lettuce assessment in
analysis/batch-023/batch_023_model_baseline.md against the live DB. In
particular check: that detection recall really matches plantCount = 34; that
nadir per-view area is unaffected by the channel plane (read
measure_plants.area_traits to confirm it scales from plant-pixel depth); and
whether canopy closure has now made per-plant area unreliable (coverage was
compounding ~26%/day, mean 0.140 on 2026-09-01, with §7.5 warning that per-plant
area becomes ill-defined at closure). Tell me where the assessment is wrong.
```

---

## Current state, so the next session isn't confused

**Updated 2026-09-06. The plane work SHIPPED — this doc's prompt above is now
partly historical.** Read
[`rail-plane-deployment-2026-09-06.md`](rail-plane-deployment-2026-09-06.md)
first; it supersedes the "not wired into anything" claims below.

| Thing | State |
| --- | --- |
| Frozen plane reference on rail1 | **LIVE.** `plane_ref_rail1.json`, enabled via `rails/rail1.json` `plane_ref` |
| `measure_cycle` | Per-site reference plane + per-cycle drift check |
| `merge_views` | Per-site reference plane (was one scalar per *cycle*) |
| `plane_ref.py` | New leaf module both stages import |
| rail2 / Floor 2 | **Unchanged**, still on the pooled plane, labelled `plane_source=pooled` |
| Prune fix | Merged to `main`; was an unpushed local commit on both Pis |
| Platform dashboard | Nadir-only rollup, p90 band, height trend — merged |
| `schemaVersion` | 2 = pooled per frame, 3 = per-site reference. **Not comparable** |
| Tests | 29/29 pass; `route.test.ts` still unrun (writes to production Neon) |
| Harvest calibration | Still with the growers; `freshWeightGEst` still 100% NULL |

**Objectives A–D above:** D is done (`rail-model-audit-2026-09-05.md`). B is
done and deployed. A (rail2) is still open but **easier than the prompt says** —
rail2 has three lit+empty archive cycles, listed in that audit. C is untouched,
and the audit could not reproduce its 0.909 ratio.

## Two open questions a human has to answer

1. **What size are the net pots?** A spec number, not a measurement. Closes the
   8–15% scale question.
2. **Was the rig physically disturbed between 2026-08-10 and 08-23?** Would
   explain the residual ~2 mm on ch1/ch3 that survives heavy leaf masking.
