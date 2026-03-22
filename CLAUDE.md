# CLAUDE.md — AgriVision AI Platform

## What is this project?

AgriVision AI is an autonomous smart farming SaaS platform. It uses centralized ML models (fine-tuned from ImageNet, served via Vercel API), IoT sensors, and Claude AI strategic reasoning to manage indoor crop production — currently mushrooms, expanding to microgreens and leafy greens. Based in Stockholm, Sweden.

The platform has three layers:
1. **Edge (Raspberry Pi 4)** — sensors, cameras (Intel RealSense D435), Tapo smart plugs, rule-based control. A Python agent (v14) runs autonomously on each Pi. The Pi captures frames and sends them to the cloud for ML analysis — it does NOT run models locally.
2. **Cloud (this codebase)** — Next.js web application on Vercel. Dashboard, batch management, scheduling, analytics, AI chat, AND ML inference. Receives sensor data + camera frames from Pi agents, runs crop-specific ML models, returns structured analysis. All in one deployment.
3. **Training (offline)** — Fine-tune models from ImageNet on proprietary crop data, export as quantized ONNX (INT8), upload to the platform. Separate repo/notebooks. Not part of this codebase.

This repo is **layer 2** — the cloud platform including ML inference.

## Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Framework | Next.js 14 (App Router) | TypeScript, `src/` directory |
| Styling | Tailwind CSS 3 | Dark theme, custom AgriVision palette |
| Database | Neon PostgreSQL | Serverless Postgres |
| ORM | Prisma | Type-safe queries, migrations |
| Auth | NextAuth.js v5 (Auth.js) | Credentials + optional OAuth |
| Charts | Recharts | All data visualizations |
| Icons | Lucide React | Consistent icon set |
| Image Storage | Vercel Blob (Public) | Camera photos + ML model files |
| ML Inference | ONNX Runtime (Node.js) | onnxruntime-node, runs in Vercel serverless functions |
| AI | Claude API (Anthropic) | Chat interface + smart scheduler + strategic decisions |
| Deployment | Vercel | Zero-config, Pro trial |

## Architecture

```
TRAINING PIPELINE (offline, GPU machine — separate repo)
┌─────────────────────────────────────────────────┐
│  ImageNet pretrained → fine-tune on crop data    │
│  → export quantized ONNX (INT8, 5-20 MB each)  │
│  → upload .onnx files to Vercel Blob             │
│  Runs on: Colab / local GPU / Hetzner            │
└──────────────┬──────────────────────────────────┘
               │ .onnx files stored in Vercel Blob
               ▼
VERCEL (cloud — this codebase)
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App                                                     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ ML INFERENCE ENGINE (/api/ml/predict)                    │     │
│  │                                                           │     │
│  │  Pi sends image + batchId                                 │     │
│  │  → looks up batch → gets cropType (e.g. "oyster_blue")   │     │
│  │  → loads correct models from Blob/cache:                  │     │
│  │    /models/oyster/contamination_v2.onnx                   │     │
│  │    /models/oyster/growth_stage_v1.onnx                    │     │
│  │    /models/oyster/weight_predictor_v3.onnx                │     │
│  │  → runs onnxruntime-node inference                        │     │
│  │  → returns structured JSON to Pi                          │     │
│  │                                                           │     │
│  │  Model selection is AUTOMATIC based on crop type.         │     │
│  │  Client picks crop when creating batch → platform         │     │
│  │  handles the rest. No manual model deployment.            │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ AGENT API (/api/agent/*)                                  │     │
│  │  POST /sensor    — ingest sensor readings                 │     │
│  │  POST /decision  — ingest Claude AI decisions             │     │
│  │  POST /photo     — ingest camera images to Blob           │     │
│  │  POST /vision    — ingest ML results (from /ml/predict)   │     │
│  │  GET  /commands   — Pi polls for user commands             │     │
│  │  PATCH /commands  — Pi acknowledges commands               │     │
│  │  GET  /models     — Pi checks for model updates            │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ DASHBOARD + BUSINESS + SETTINGS APIs                      │     │
│  │  /api/dashboard/*  — live data, history                    │     │
│  │  /api/batches/*    — batch lifecycle CRUD                  │     │
│  │  /api/analytics/*  — profit, yield, KPIs                   │     │
│  │  /api/schedule/*   — calendar + AI smart scheduler         │     │
│  │  /api/chat         — AI assistant with farm context        │     │
│  │  /api/commands/*   — issue commands to Pi                  │     │
│  │  /api/settings/*   — farm, zones, users, API keys          │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ FRONTEND (React pages)                                    │     │
│  │  / (Dashboard)  /batches  /scheduler                      │     │
│  │  /analytics     /chat     /settings                       │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  Neon PostgreSQL (all persistent data)                            │
│  Vercel Blob (photos + .onnx model files)                        │
└─────────────────────────────────────────────────────────────────┘
               ▲                    │
               │ HTTP POST          │ HTTP GET (commands)
               │ (sensor, photo,    │ JSON responses
               │  request predict)  │ (ML results, commands)
               │                    ▼
RASPBERRY PI 4 (edge, one per farm/zone)
┌─────────────────────────────────────────────────────────────────┐
│                                                                   │
│  Hardware:                                                        │
│  • Intel RealSense D435 (RGB 1280x720 + depth 1280x720)         │
│  • ESP32 sensors (temperature, humidity, CO2)                     │
│  • Tapo P110 smart plugs (humidifier, fan, light)                │
│                                                                   │
│  Software (Python, async):                                        │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ TIER 1 — RULE ENGINE (always on, no internet needed)       │   │
│  │ • Humidity control: if < 85% → mist, if > 92% → fan       │   │
│  │ • Fresh air cycles: fan every 20-30 min for CO2            │   │
│  │ • Light schedule: 12h on/off during fruiting               │   │
│  │ • Temperature alerts: warn if outside 15-25°C range        │   │
│  │ Handles 95% of operations. Cost: FREE.                     │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ TIER 2 — ML VISION (cloud, every 4-6h)                     │   │
│  │ • Capture RGB + depth frame from RealSense                 │   │
│  │ • POST image to /api/ml/predict                            │   │
│  │ • Receive structured analysis (counts, weight, quality)    │   │
│  │ • Model selection is automatic based on batch crop type     │   │
│  │ Cost: FREE (Vercel serverless compute)                      │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ TIER 3 — STRATEGIC AI (Claude API, 2-4x daily)            │   │
│  │ • Receives structured ML outputs (numbers, not photos)     │   │
│  │ • Harvest timing, profit optimization, scheduling          │   │
│  │ • Every decision explained in natural language              │   │
│  │ Cost: ~0.25 kr/call, ~30 kr/month                          │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ CLOUD SYNC (continuous)                                     │   │
│  │ • Sensor data every 5-10 min → /api/agent/sensor           │   │
│  │ • Photos every 4-6h → /api/agent/photo                     │   │
│  │ • ML prediction request → /api/ml/predict                   │   │
│  │ • AI decisions → /api/agent/decision                        │   │
│  │ • ML results → /api/agent/vision                            │   │
│  │ • Command poll every 30s → /api/agent/commands              │   │
│  │ • All calls try/except — never crashes                      │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Fallbacks: Google Sheets + Telegram remain active                │
│  If internet drops: Tier 1 keeps crops alive autonomously         │
└─────────────────────────────────────────────────────────────────┘
```

## Three-Tier Reliability Model

- **Tier 1 (always on):** Rule engine on Pi. No internet needed. 95% of operations. Free.
- **Tier 2 (cloud ML):** ML inference on Vercel. Pi sends photo → cloud runs crop-specific models → returns analysis. Every 4-6h. Free (serverless).
- **Tier 3 (strategic AI):** Claude API. Profit optimization, harvest timing, scheduling. 2-4x daily. ~30 kr/month.

**If internet drops:** Tier 1 keeps crops alive. Lose Tier 2+3 = miss ~10-15% optimization. **If Claude API drops:** Tier 1+2 still work. **All three down:** Impossible (Tier 1 is local).

## ML Inference on Vercel

### Why cloud, not Pi

When a client says "I grow lion's mane," the platform automatically uses lion's mane models. No SSH, no model deployment to devices. Model upgrades reach all clients instantly. This is what makes it SaaS.

### Endpoint: POST /api/ml/predict

```json
// Request (from Pi, authenticated by API key)
// Pi already knows the crop type from its batch config — no DB lookup needed
{
  "cropType": "oyster_blue",
  "image": "<base64 JPEG>"
}

// Server logic:
// 1. Map cropType to model family ("oyster_blue" → "oyster")
// 2. Query MLModel for active models where cropType = "oyster"
// 3. Fetch .onnx from Blob (cached in /tmp after first load)
// 4. Run onnxruntime-node inference
// 5. Return results — no batch lookup, no DB dependency

// Response
{
  "mushroom_count": 12,
  "pin_count": 3,
  "avg_diameter_cm": 6.2,
  "contamination_risk": 0.02,
  "estimated_weight_g": 380,
  "growth_rate_cm3_day": 1.8,
  "harvest_readiness": 0.72,
  "quality_prediction": "A",
  "models_used": {
    "contamination": "v2.0.0",
    "growth_stage": "v1.0.0",
    "weight": "v3.0.0"
  }
}
```

Note: batchId is only needed when *storing* results (POST /api/agent/vision), not when *requesting* predictions. The Pi knows its crop type locally.

### Model storage

ONNX files stored in Vercel Blob organized by crop:
```
models/oyster/contamination_v2.onnx
models/oyster/growth_stage_v1.onnx
models/oyster/weight_predictor_v3.onnx
models/lions_mane/contamination_v1.onnx
...
```

MLModel database table tracks versions, accuracy, and active status. Settings → Models page manages the registry.

### Constraints
- Models must be quantized INT8 ONNX (5-20 MB each)
- Vercel timeout: 60s (Pro). Inference should complete in <2s.
- Models cached in /tmp within serverless function instance
- If no models exist for a crop → return fallback response, Pi uses Claude vision

### Adding a new crop
1. Collect training photos from clients growing that crop
2. Fine-tune + export ONNX in training pipeline
3. Upload to Blob + register in MLModel table
4. All clients with that crop instantly get ML predictions

## Database Schema Overview

Multi-tenant SaaS:
- `Organization` → `Farm` → `Zone` → data tables
- `User` (role: OWNER/OPERATOR/VIEWER)
- `ApiKey` (scoped to farm, used by Pi agents)
- `Batch` (core unit — cropType drives automatic model selection)
- `SensorReading` (time-series: temp, humidity, CO2, VPD)
- `EnergyReading` (time-series from Tapo P110 smart plugs: device, kWh, cost. Belongs to Zone or Farm depending on device scope)
- `Photo` (RGB + depth URLs in Blob, ML analysis JSON)
- `AIDecision` (Claude reasoning, action, cost. Belongs to Batch)
- `Harvest` (actual weight, revenue, cost breakdown, profit)
- `ScheduleEvent` (planned events)
- `DeviceState` (device status — scope is ZONE or FARM. Lights are per-zone. Humidifier/HVAC may be farm-wide)
- `Command` (queued for Pi execution)
- `MLModel` (registry: name, version, cropType, ONNX Blob URL, accuracy, isActive)
- `FarmDefaults` (default costs and prices per farm: electricity kr/kWh, substrate kr/bag, labor kr/batch, market prices per crop type)

### Device scoping

Not all devices are zone-level. A humidifier or HVAC might serve the entire farm, while lights are per-zone:

```
DeviceState
  - farmId (required) — all devices belong to a farm
  - zoneId (optional) — null for farm-wide devices
  - scope: ZONE | FARM
  - deviceType, deviceName, state, lastToggled
```

When the AI decides "turn on lights in Zone A" → zone-scoped device. When it decides "increase humidity" → might be a farm-scoped humidifier affecting all zones. The dashboard shows farm-level devices in a shared section and zone-level devices under each zone.

### Energy tracking

Tapo P110 smart plugs meter electricity. The Pi reads kWh and pushes to the cloud:

```
EnergyReading
  - farmId, zoneId (optional), deviceName
  - kWh (cumulative or delta)
  - costKr (calculated: kWh × electricity price from FarmDefaults)
  - timestamp
```

Energy cost per batch = sum of EnergyReadings during batch duration for that zone (+ proportional share of farm-wide devices).

### Cost and revenue data sources

| Data | Source | Where entered |
|---|---|---|
| Energy (kWh) | Tapo P110 smart plugs | Automatic — Pi pushes to cloud |
| Energy cost (kr) | kWh × electricity price | Automatic — price from FarmDefaults |
| Substrate cost | Known by farmer | At batch creation (default from FarmDefaults) |
| Labor cost | Estimated by farmer | FarmDefaults (kr/batch), overridable per batch |
| Revenue | Weight × market price | At harvest recording |
| Market price (kr/kg) | Known by farmer | At harvest (default from FarmDefaults per crop) |

### FarmDefaults (stored in Farm record or separate table)

```
- electricityPriceKrPerKwh: 1.50 (or integrate Nordpool API later)
- defaultSubstrateCostPerBag: 15.0
- defaultLaborCostPerBatch: 200.0
- defaultMarketPrices: { "oyster_blue": 150, "lions_mane": 250, "shiitake": 180 } (kr/kg)
```

These auto-fill into batch creation and harvest forms. Can be overridden per batch.

## Key Domain Concepts

**Facility (Farm):** A physical location where crops are grown. A client might have multiple facilities in different locations (e.g. Södermalm warehouse + Vällingby basement). Each facility has its own address, timezone, and set of zones. The top bar has a **farm selector** so users can switch between facilities — all data (dashboard, batches, scheduler, analytics) filters to the selected farm.

**Zone:** A controlled growing environment within a facility — one room, tent, shelf section, or climate area. Each zone has its own hardware (camera, sensors, plugs) and runs one set of environmental conditions at a time. One Pi agent reports to one zone. A zone can hold multiple batches simultaneously if they share the same conditions, but typically one batch per zone.

**Batch:** A crop cycle that happens inside a zone. Has a start and end. Zone A might run Batch B-001 (oyster, 28 days), then B-005 (lion's mane, 35 days), then B-012 (shiitake, 42 days). The batch's cropType drives automatic ML model selection.

**Multi-zone batch creation:** Most of the time, farmers plant the same crop in all zones. The "New Batch" form supports: single zone, multiple zones (checkboxes), or "All Zones" (one click). Selecting multiple zones creates one batch per zone with the same crop, substrate, and bag count — each gets its own batch number (B-2026-010, B-2026-011...) because they track independently. Cost defaults (substrate, labor) auto-fill from FarmDefaults.

**Growth phases:** COLONIZATION → FRUITING → HARVESTING. Colonization = mycelium spreads through substrate (monitoring only). Fruiting = triggered manually ("fruiting start"), mushrooms grow 7-14 days. Harvest timing = profit-optimized by AI.

**New Batch vs Smart Scheduler:**
- **New Batch** (from `/batches` → "+ New Batch") = manual operational action. You know what to plant, where, when. You pick zone, crop, bags, date. Like creating a task.
- **Smart Scheduler** (from `/scheduler`) = AI planning from a business need. Input: "I need 5 kg of oyster delivered April 20." Output: AI recommends planting date, zone (based on availability), bag count, confidence score. Click "Create Batch from Plan" to execute. Future: handles multi-batch staggering for continuous harvest cycles.

**Harvest profit optimizer:** Current weight × market price vs. projected gain − additional costs. Recommends most profitable harvest day. Example: wait 2 days = +18g still A-grade = +4.1 kr/bag.

**Automatic model selection:** Batch cropType → model family → active ONNX files. Client never touches ML.

**Sensor targets (mushrooms):**
- Temperature: 17-20°C (colonization), 15-18°C (fruiting)
- Humidity: 85-95% (fruiting)
- CO2: <1000 ppm
- Light: 12h cycle during fruiting

## Project Pages

| Route | Purpose |
|-------|---------|
| `/` | Live dashboard — sensor gauges, camera feed, AI decisions, devices, **zone map** |
| `/batches` | Batch lifecycle management + timeline |
| `/scheduler` | Calendar + AI production planning (smart scheduler) |
| `/analytics` | Profit, yield, cost-per-gram trends |
| `/chat` | AI assistant with farm context |
| `/settings` | Farm, zones, API keys, users, models |

### Zone Map (new component on Dashboard)

A visual overview of the entire facility. Shows all zones as rectangular blocks arranged in a grid. Inside each zone block, batches are shown as colored sub-blocks. The batch color represents maturity on a gradient:

```
Maturity gradient:
  PLANNED/EARLY     →    MID-CYCLE     →    NEAR HARVEST
  yellow (#e8a830)  →  yellow-green    →    green (#4abe7b)
  
  COLONIZATION = yellow tones (early, growing mycelium)
  EARLY FRUITING = yellow-green (pins forming)
  LATE FRUITING = green (clusters mature, approaching harvest)
  READY TO HARVEST = bright green with pulse animation
  HARVESTED = gray (completed)
```

Example layout for a facility with 4 zones:
```
┌─────────────────┐  ┌─────────────────┐
│ ZONE A           │  │ ZONE B           │
│ ┌──────┐┌──────┐│  │ ┌──────────────┐│
│ │B-001 ││B-002 ││  │ │   B-002      ││
│ │ 🟡   ││ 🟡   ││  │ │   🟢         ││
│ └──────┘└──────┘│  │ └──────────────┘│
│ 18.4°C  87% RH  │  │ 17.2°C  91% RH  │
└─────────────────┘  └─────────────────┘
┌─────────────────┐  ┌─────────────────┐
│ ZONE C           │  │ ZONE D           │
│ ┌──────────────┐│  │ ┌──────┐┌──────┐│
│ │   B-003      ││  │ │B-003 ││B-004 ││
│ │   ⚪         ││  │ │ ⚪   ││ 🟢   ││
│ └──────────────┘│  │ └──────┘└──────┘│
│ OFFLINE          │  │ 19.1°C  85% RH  │
└─────────────────┘  └─────────────────┘
```

Each zone block shows: zone name, batch sub-blocks with maturity color, current sensor summary (temp + humidity), agent status. Clicking a zone navigates to the dashboard filtered to that zone. Clicking a batch navigates to the batch detail page.

This is the first thing the user sees on the dashboard — the facility-level overview. Below it: the detailed sensor charts, camera feed, and AI decisions for the currently selected zone.

### Top Bar Navigation

```
[ Farm Selector ▾ ] / [ Zone Selector ▾ ]  •  🟢 ONLINE 2m ago  |  15:48:56
```

- **Farm selector:** dropdown of all farms in the user's organization. Switching farms reloads all data.
- **Zone selector:** dropdown of zones in the selected farm. "All Zones" shows the zone map. Selecting a specific zone shows detailed dashboard for that zone.

## Build Status

Steps 1-11 COMPLETE. Platform deployed on Vercel, receiving live Pi data.

### Next to build:
- **Zone Map component** — visual facility overview on dashboard showing all zones with batch maturity gradient (yellow→green). Clickable zones and batches.
- **Farm selector** in top bar — switch between facilities, all pages filter to selected farm
- **Top bar "All Zones" view** — zone selector gets "All Zones" option that shows zone map instead of single-zone detail
- **Multi-zone batch creation** — batch form supports selecting multiple zones or "All Zones" at once, creates one batch per zone with same config
- **FarmDefaults** — add to Settings → Farm: electricity price (kr/kWh), default substrate cost/bag, default labor cost/batch, default market prices per crop type. Auto-fill into batch and harvest forms.
- **EnergyReading table + Pi push** — Tapo P110 kWh data pushed by Pi, stored per device, cost auto-calculated from electricity price default
- **DeviceState scope refactor** — add farmId and scope (ZONE/FARM) to DeviceState. Farm-wide devices (humidifier, HVAC) show in shared section. Zone-specific devices (lights) show per zone.
- Photo upload fix (handle .npy depth files, verify Blob token)
- Clean seed data vs real data (dashboard should show real Pi data, not seed placeholders)
- AI decisions feed: query should show real decisions from Pi, not just seed data
- `POST /api/ml/predict` endpoint (onnxruntime-node) — Pi sends cropType + image directly, no batchId lookup needed
- Model upload flow in Settings → Models
- Pi agent: replace Claude vision calls with /api/ml/predict (when models ready)
- Smart scheduler: verify Claude API call works with real batch history data

## Environment Variables

```
DATABASE_URL          — Neon Postgres connection string
NEXTAUTH_SECRET       — Session encryption secret
ANTHROPIC_API_KEY     — Claude API for chat + scheduler + decisions
BLOB_READ_WRITE_TOKEN — Vercel Blob for photos + model files
```

## Code Conventions

- TypeScript everywhere (.ts/.tsx)
- Prisma singleton from `src/lib/prisma.ts`
- Agent routes: API key auth via `src/lib/api-key.ts`
- ML predict route: API key auth (same as agent)
- Dashboard routes: NextAuth session auth
- Timestamps: stored UTC, displayed in farm timezone
- Components organized by page in `src/components/`

## Pilot Partners

1. **Mushu Mushrooms** — 50m², Lion's Mane + Oyster + Shiitake. Ready now.
2. **Urban Seeds** — 30m² microgreens, Stockholm.
3. **Nära** — 800m² industrial vertical farm.

## Business Model

- Business from €500/mo (unlimited zones, full scheduling, profit analytics, ML vision, API, dedicated support)
- OEM custom (white-label for equipment manufacturers)
