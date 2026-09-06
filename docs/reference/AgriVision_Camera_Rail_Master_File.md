> ## ⚠ STATUS — added 2026-09-06, not part of the original document
>
> **This is the HARDWARE master file, and it is substantially out of date.**
> It is preserved because its firmware, wiring and engineering-record sections
> are still the only record of those decisions, and §"Engineering record" is
> explicitly a do-not-relitigate list worth keeping.
>
> **It is NOT the document the rail docs cite.** References to `§4.1`, `§5.11`,
> `§5.14`, `§5.15`, `§6`, `§7.2`, `§7.2b`, `§7.3`–`§7.7`, `§8`, `§9`, `§10`
> throughout `robust-pot-distance.md`, `rail-pipeline-todo.md` and
> `rail-model-audit-2026-09-05.md` point at a LATER, expanded revision that adds
> numbered sections 6–10 (site maps, the vision/measurement pipeline, tooling
> inventory, open items, operational gotchas). That revision is not in this
> repo. **If you have it, add it here** — the § references are dangling until
> you do.
>
> **Verified stale against the live rig, 2026-09-06:**
>
> | This file says | Actually |
> | --- | --- |
> | 6 stops, ~28.5 cm spacing | **11 stops, 13.08 cm** (`rails/rail1.json`) |
> | "NO cron installed (removed by decision — the agent is the sole trigger)" | **cron runs the pipeline** `0 7,11,15,19` on pi4-004 |
> | pi4-005 WiFi power-save "still pending" | **done** — `/etc/NetworkManager/conf.d/wifi-powersave.conf` exists |
> | Depth glare: "only 54–77% valid pixels" | **91.8% mean** (rail1), 91.7% (rail2), since fixed by cardboard + 848×480 + cups |
> | ~26 MB per cycle | ~14.4 MB/cycle |
> | Storage retention "undecided" | Decided: depth is **never** pruned (`--prune-days` ignored, default 0) |
> | Scan is triggered by an external agent calling `scan_cycle.py` | `run_pipeline.py` orchestrates capture → traits → fusion → push |
>
> Sections that ARE still current: Inventory & network, Firmware, the HTTP API,
> direction conventions, and the Engineering record.
>
> See [`../rail-plane-deployment-2026-09-06.md`](../rail-plane-deployment-2026-09-06.md)
> for the current state of the measurement pipeline.
>
> ### Redaction note
>
> The original document carried the router admin password and the WiFi PSK
> inline. They are removed here. Git history is permanent and effectively
> impossible to purge, so a credential committed once is a credential leaked
> once, regardless of who can read the repo today. Keep them in a password
> manager, or in `.env` on the Pis, which is gitignored for exactly this
> reason (see `config.py`: "per-machine IDENTITY + SECRETS. NEVER committed").
>
> ---

# AgriVision Camera-Rail System — Master File (FINAL, both rails operational)

## System overview
Two autonomous motorized camera rails for plant monitoring. Each rail: a **PD Stepper board** (ESP32-S3 + TMC2209 + AS5600, thingsbyjosh.com) driving a NEMA 17 belt rail (~141.5 cm), carrying a carriage with a **Raspberry Pi 4 + Intel RealSense D435**. Control is HTTP over WiFi; the Pi on each carriage orchestrates scans and stores captures. A grow-controller agent triggers scans by executing a script on each Pi and checking the exit code. Both rails verified end-to-end with real captures (rail #1: 2026-07-10, rail #2: 2026-07-11).

## Inventory & network
| | Rail #1 | Rail #2 |
|---|---|---|
| Board hostname | pd-stepper-pi4-004 | pd-stepper-pi4-005 |
| Board MAC | 9C:13:9E:9A:A2:9C | 10:20:BA:0E:D5:30 |
| Board IP (DHCP-**reserved**) | **192.168.1.7** | **192.168.1.8** |
| Paired Pi | pi4-004 — LAN 192.168.1.4, Tailscale 100.73.214.48 | pi4-005 — LAN 192.168.1.6, Tailscale 100.68.78.124 |
| D435 serial | 819112070053 | 832112071968 |
| Endstop | switch at RIGHT end, C→J6 pin1 (GND), NO→J6 pin2 (AUX1=GPIO14) | same |

- Router: Huawei 192.168.1.1 (admin / **[password redacted]**), SSID `Tele2Internet-b9b01` / **[PSK redacted]**. DHCP bindings set for both boards + all Pis (pi4-003 = .9). **Note: changing DHCP settings restarts the router's DHCP — devices may need a power cycle to re-lease.**
- Power: each board on a **12V PD charger** (Power Good ~11.9 V) for motor operation. Pi USB = flashing/serial only (Power Bad — homing safely refuses). Single USB-C: flash XOR run.
- Pi WiFi: power-save **disabled permanently** on pi4-004 via `/etc/NetworkManager/conf.d/wifi-powersave.conf` (`[connection]` / `wifi.powersave = 2`). ⚠️ **Still pending on pi4-005** (was `Power Management:on` — same drop risk).
  > ⚠ **2026-09-06: DONE on pi4-005 too** — the conf file exists there. Verified.

## Firmware (identical on both boards, hostname differs)
Source of truth on **pi4-004 only**: `~/PD-Stepper/Software/PD_Stepper_Web_Server/` (rail #1) and `..._005/` (rail #2). Both boards are flashed from pi4-004's USB. Toolchain: `export PATH=$PATH:~/bin`, then:

```
arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc .
arduino-cli upload -p /dev/ttyACM0 --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc .
```

`CDCOnBoot=cdc` is REQUIRED — without it Serial goes to UART0 and the USB monitor shows nothing. Verify which board is plugged in by the MAC printed by esptool before flashing.

**Boot behavior (Behavior 1 — recovery):** ~1.5 s after Power Good, auto-home: seek RIGHT (STEP/DIR direct stepping, hard-coded current 70) until GPIO14 reads LOW → stop → back off 500 steps → **zero = 0 at right end** → drive to **park −72435** (middle) → software limits armed. Fully self-recovering after any power cut.

**Coordinates:** 0 = home = right end; negative leftward; TRAVEL_STEPS = 144870 (~1024 steps/cm); END_MARGIN_STEPS = 1024 (1 cm); usable clamp **[−143846, −1024]**. Both rails currently share these numbers (rail #2's clearances looked correct on live runs; travel never separately measured — revisit only if its end clearances ever look off).

**HTTP API** (both boards, port 80):
- `POST /update` — `moveTo=X` (absolute, clamped — primary) | `moveSteps=N` (relative) | `slider=V` (velocity; never >~500 from standstill)
- `POST /home` (clears isHomed immediately; homing runs in main loop) · `GET /homed` · `GET /steppos` → `pos= target= moving=` · `GET /limits` · `GET /endstop` (pin states) · `GET /homelog` (homing trace over WiFi)
- `POST /save` settings: `current=70 microsteps=16 standstill_mode=NORMAL setvoltage=12 enabled1=enabled` — **reset on every flash AND reboot**; scan script self-heals via ensure_settings(); homing immune (hard-coded values)
- Stock: `/powergood /voltage /position /stallguard`

**Direction conventions (critical if ever editing firmware):** `moveTo/moveSteps` positive = RIGHT (DIR LOW). `moveAtVelocity` positive = LEFT (**inverted** — never use for homing). Homing/backoff use direct STEP/DIR stepping so position accounting stays coherent; on any homing abort, `setPoint = CurrentPosition`.

## Scan system (Behavior 2 — the agent's command)
**`~/scan_cycle.py` on each Pi** (same file; per-Pi config at top: `BOARD`, `CAPTURE_CMD` path):

- Flow: check `/powergood` → `ensure_settings()` → **re-home** (fresh zero every cycle; waits for park) → sweep far→home: stops `[−141846, −115282, −86717, −58153, −29588, −1024]` (stop 1 ≈ 3 cm from far end, ~28.5 cm spacing, last 1 cm from switch) **[2026-09-06: SUPERSEDED — 11 stops at 13.08 cm, one per hole row; see `rails/rail1.json`, whose anchors were MEASURED and differ per rail]** → at each stop: verified `moveTo` (posts, confirms target registered, retries ×3 — fixes a firmware quirk where the first post-homing moveTo is silently dropped) → wait `moving=no` → 1.5 s settle → run `CAPTURE_CMD` → finally park at −72435.
- `CAPTURE_CMD = python3 /home/<pi>/test_realsense.py --label "scan_stop${RAIL_STOP_INDEX}_pos${RAIL_POS}"` — blocking; non-zero capture exit aborts the cycle.
- Camera script `~/test_realsense.py` (each Pi): 1280×720, 30-frame AE warm-up, saves rgb.jpg + depth.npy + depth_vis.jpg + comparison.jpg to `~/agrivision/realsense_tests/`, exits 0. ~6.5 MB × 4 files per stop → **~26 MB per cycle**.
- Modes: `--dry` (motion only), `--status` (health print), default = full scan.

**Agent contract (per rail):**

```
execute on the rail's Pi:   python3 /home/pi4-004/scan_cycle.py     (rail 1)
                            python3 /home/pi4-005/scan_cycle.py     (rail 2)
exit 0  → cycle complete: 24 labeled files in ~/agrivision/realsense_tests/, carriage parked
exit ≠ 0 → failure, reason printed (no power / homing abort / move timeout / capture error)
optional pre-checks: GET http://<board>/powergood , /homed
```

Cycles are idempotent and safe to re-run. NO cron installed (removed by decision — the agent is the sole trigger). Boards may be power-cycled at any time; they self-home and re-park.

> ⚠ **2026-09-06: SUPERSEDED.** A cron DOES run the pipeline — `0 7,11,15,19`
> on pi4-004, `5 6,10,14,18` on pi4-005, deliberately inside the lit window.
> It calls `run_pipeline.py`, which orchestrates capture → `measure_cycle` →
> `merge_views` → `push_traits`, not `scan_cycle.py` directly.

## Engineering record (do not relitigate)
1. **Sensorless StallGuard homing: proven non-viable** on these rails — contact-tested both ends × speeds 2500–25000 µs × currents 45/70% × two belt tensions via a custom /seektest; free-running and at-end SG overlap everywhere (belt slips before motor stalls). Physics, not tuning. Microswitch chosen; worked first try.
2. **GPIO map trap:** schematic net "PIU2018" = package pin 18 = **GPIO14** (AUX1), "PIU2017" = **GPIO13** (AUX2). GPIO17/18 are the TMC UART — configuring them as inputs breaks boot (server never starts; ping works, port 80 refused).
3. AUX pins have **no external pull-ups** — firmware uses INPUT_PULLUP.
4. Serial debugging on ESP32-S3 requires the CDC build flag (cost hours before discovery).
5. First-moveTo-after-homing drop + stale `/homed` yes: both fixed (endpoint clears state; script verifies+retries).

## Open items (for the agent phase)

> ⚠ **2026-09-06: items 1–3 are DONE.** Annotated inline below. Only item 4
> (cosmetic) may still stand.

1. ~~**pi4-005 WiFi power-save OFF**~~ **DONE** (2026-09-06 verified: the conf file exists on pi4-005).
2. ~~**Storage retention** — undecided.~~ **DECIDED (2026-09-06): depth is NEVER pruned.** `run_pipeline.py` accepts `--prune-days` but ignores it, and defaults to 0. Do not add the proposed cron — depth `.npy` is the calibration archive, and pruning is how `scan01` lost its. Actual footprint is ~14.4 MB/cycle, ~50 MB/day; disk is 43% used, ~20 months of headroom.
3. ~~**Depth glare** — only 54–77% valid pixels.~~ **SOLVED.** Cardboard diffuser + 848×480 capture + net-pot cups. Measured 2026-09-06 over all present records since 09-01: **91.8% mean on rail1, 91.7% on rail2**. Watch for *progressive* decline (humidity killed a D405 in three weeks in Kim et al. 2024); ours is fluctuating, not collapsing.
4. Cosmetic: scan_cycle.py comment says "rail #1" on rail #2; test_realsense.py's final scp hint has a stale hostname.

## Operational gotchas
- Right Pi, right IP, always (firmware work = pi4-004 only; verify plugged board by MAC).
- Every flash/reboot wipes /save settings — motor buzzes weakly at default current until re-saved (scan self-heals).
- Boot auto-home MOVES THE CARRIAGE on every power-up — keep rails clear.
- Never paste C++ into bash; use scp'd Python patcher scripts (pattern established, examples in outputs).
- Router DHCP edits restart its DHCP server — expect to power-cycle clients.
- Delete stale script copies (e.g. scan_cycle1.py) — running old versions caused confusion twice.
