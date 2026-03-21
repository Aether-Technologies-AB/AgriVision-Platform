# CLAUDE.md — AgriVision AI Platform

## What is this project?

AgriVision AI is an autonomous smart farming SaaS platform. It uses on-device ML models, IoT sensors, and Claude AI strategic reasoning to manage indoor crop production — currently mushrooms, expanding to microgreens and leafy greens. Based in Stockholm, Sweden.

The platform has three layers:
1. **Edge (Raspberry Pi 4)** — sensors, cameras (Intel RealSense D435), ONNX ML inference, Tapo smart plugs, rule-based control. A Python agent (v13, evolving to v14) runs autonomously on each Pi.
2. **Cloud (this codebase)** — Next.js web application on Vercel. Dashboard, batch management, scheduling, analytics, AI chat. Receives data from Pi agents via REST API.
3. **Training (offline)** — Fine-tune models from ImageNet on proprietary crop data, export as quantized ONNX for Pi inference. Separate repo/notebooks.

This repo is **layer 2** — the cloud platform.

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
| Image Storage | Vercel Blob | Camera photos from Pi agents |
| AI | Claude API (Anthropic) | Chat interface + smart scheduler |
| Deployment | Vercel | Zero-config |

## Architecture

```
Raspberry Pi (per farm)              Vercel (cloud)
┌──────────────────────┐            ┌──────────────────────────┐
│ RealSense D435 (RGB+D)│           │ Next.js App              │
│ ESP32 sensors          │──HTTP──→ │ ├─ /api/agent/*  (ingest)│
│ ONNX models (local ML) │  POST   │ ├─ /api/dashboard/* (UI) │
│ Claude API (strategic)  │         │ ├─ /api/chat     (AI)   │
│ Tapo plugs (actuators)  │←─HTTP──│ ├─ /api/commands  (ctrl) │
│ Python agent v14        │  GET    │ └─ Pages (React)         │
└──────────────────────┘            │                          │
                                    │ Neon PostgreSQL           │
                                    │ Vercel Blob (photos)      │
                                    └──────────────────────────┘
```

Pi pushes data via POST. Pi polls for commands via GET every 30s. Frontend polls `/api/dashboard/live` every 10s for real-time feel. No WebSockets needed at pilot scale.

## Three-Tier Reliability Model

The farm never depends on a single point of failure:
- **Tier 1 (always on):** Rule engine on Pi. Humidity control, fresh air cycles, light schedules. No internet needed. Handles 95% of operations. Free.
- **Tier 2 (local ML):** ONNX models on Pi. Growth measurement, contamination detection, quality grading. No internet needed. Runs every 4-6h. Free.
- **Tier 3 (strategic):** Claude API. Profit optimization, harvest timing, scheduling, anomaly reasoning. 2-4x daily. ~0.25 kr/call, ~30 kr/month. If API goes down 24h, crops are safe — you just miss ~10-15% profit optimization.

## Database Schema Overview

Multi-tenant SaaS structure:
- `Organization` → `Farm` → `Zone` → data tables
- `User` (belongs to org, has role: OWNER/OPERATOR/VIEWER)
- `ApiKey` (scoped to farm, used by Pi agents to authenticate)
- `Batch` (core unit — tracks a crop from planting to harvest)
- `SensorReading` (time-series: temp, humidity, CO2, VPD)
- `Photo` (RGB + depth URLs, ML analysis JSON)
- `AIDecision` (Claude's reasoning, action taken, cost)
- `Harvest` (actual weight, revenue, cost breakdown, profit)
- `ScheduleEvent` (planned events: inoculation, harvest, delivery)
- `DeviceState` (humidifier/fan/light on/off status)
- `Command` (user-issued commands queued for Pi to execute)
- `MLModel` (model registry: name, version, ONNX file URL, active flag)

Full schema is in `prisma/schema.prisma`. See `agrivision_build_spec.md` for complete field definitions.

## Key Domain Concepts

**Growth phases:** COLONIZATION → FRUITING → HARVESTING. Colonization is when mycelium spreads through substrate (no intervention needed, just monitoring). Fruiting is triggered manually (user confirms "fruiting start"), then mushrooms grow over ~7-14 days. Harvest timing is profit-optimized by AI.

**Two-tier cost architecture:** Cheap rule-based control handles humidity/fan cycles (95% of actions, free). Expensive AI handles strategic decisions (5% of actions, ~0.25 kr each). Never waste an AI call on something a simple threshold can handle.

**Harvest profit optimizer:** The AI calculates: current weight × market price vs. projected weight gain minus additional energy/facility costs. It recommends the most profitable day, not just "big enough." Example: wait 2 days = +18g still A-grade = +4.1 kr/bag. Wait 5 days = +90g but B-grade = -13 kr/bag. AI finds the sweet spot.

**Smart scheduler:** Input a delivery date + kg needed → AI back-calculates planting date, zone assignment, bag count, accounting for crop cycle time, facility capacity, and batch staggering.

**Sensor targets (mushrooms):**
- Temperature: 17-20°C (colonization), 15-18°C (fruiting)
- Humidity: 85-95% (fruiting — controlled by AI via humidifier)
- CO2: <1000 ppm (fresh air cycles every 20-30 min)
- Light: Indirect, 12h cycle during fruiting

## Project Pages

| Route | Purpose |
|-------|---------|
| `/` | Live dashboard — sensor gauges, camera feed, AI decision feed, device controls |
| `/batches` | Batch list + detail view with full event timeline |
| `/scheduler` | Calendar + smart scheduler (AI-powered production planning) |
| `/analytics` | Profit tracking, yield curves, cost-per-gram trends, ROI |
| `/chat` | AI assistant — ask anything about your farm in natural language |
| `/settings` | Farm/zone config, API keys, users, notifications |
| `/login` | Auth |

## API Structure

**Agent endpoints** (`/api/agent/*`) — called by Pi, authenticated by API key in `Authorization: Bearer` header:
- `POST /api/agent/sensor` — push sensor reading
- `POST /api/agent/vision` — push ML inference results
- `POST /api/agent/decision` — push Claude AI decision + reasoning
- `POST /api/agent/photo` — upload camera image (multipart)
- `GET /api/agent/commands?zoneId=...` — poll for pending commands
- `PATCH /api/agent/commands/:id` — acknowledge/complete command
- `GET /api/agent/models?cropType=...` — check for model updates

**Dashboard endpoints** (`/api/dashboard/*`) — called by frontend, authenticated by session:
- `GET /api/dashboard/live/:zoneId` — latest sensors + devices + agent status
- `GET /api/dashboard/history/:zoneId?range=24h|7d|30d` — sensor time-series

**Resource endpoints** — standard CRUD:
- `/api/batches` — list, create, update batches
- `/api/batches/:id/timeline` — full event timeline
- `/api/schedule` — list, create schedule events
- `/api/schedule/smart` — AI-powered production planning
- `/api/analytics/profit` — profit analytics
- `/api/analytics/yield` — yield analytics
- `/api/chat` — AI chat with farm context injection
- `/api/commands/:zoneId` — issue command to Pi agent

## Design System

Dark mode. Agricultural/organic feel — NASA mission control meets greenhouse.

**Colors:**
```
bg:          #0a0f0d  (near-black green)
bgCard:      #111916
border:      #1e2e25
green:       #4abe7b  (primary brand color)
greenBright: #6ee7a0
greenDim:    #2d5a3f
amber:       #e8a830  (warnings, highlights)
red:         #ef4444  (alerts, errors)
blue:        #3b82f6  (info, colonization phase)
purple:      #a78bfa  (ML/AI indicators)
text:        #e8f0eb  (primary)
textMid:     #8aaa96  (secondary)
textDim:     #4a6b55  (muted)
```

**Typography:** Monospace (JetBrains Mono / SF Mono) for data values and sensor readings. Clean sans-serif (Outfit) for labels and body text.

**Principles:**
- Data-dense but not cluttered
- Real-time feel: subtle animations on data changes, pulsing status dots
- Phase-aware coloring: blue = colonization, green = fruiting, amber = harvested/warning, red = alert

## Code Conventions

- All files TypeScript (`.ts` / `.tsx`)
- Use Prisma client singleton from `src/lib/prisma.ts`
- API routes return proper HTTP status codes with `{ error: string }` on failure
- Agent API routes validate API key via `src/lib/api-key.ts` middleware
- Dashboard API routes check NextAuth session
- All timestamps stored UTC, displayed in farm timezone
- Use Prisma `include` and `select` to avoid N+1 queries
- React components in `src/components/` organized by page
- Shared UI primitives in `src/components/ui/`
- Custom hooks for polling: `usePolling(url, intervalMs)` with stale-data indicators

## Environment Variables

```
DATABASE_URL          — Neon Postgres connection string
NEXTAUTH_SECRET       — Random secret for session encryption
NEXTAUTH_URL          — App URL (http://localhost:3000 in dev)
ANTHROPIC_API_KEY     — For AI chat + smart scheduler
BLOB_READ_WRITE_TOKEN — Vercel Blob for photo storage
```

## Build Order

Work through these sequentially. Each step should be testable before moving on.

1. Project scaffold (Next.js + Tailwind + Prisma + layout with sidebar)
2. Database schema + seed data (realistic demo: 1 org, 1 farm, 3 zones, 5 batches, 48h sensor data)
3. Auth (NextAuth credentials provider, login/register, route protection)
4. Agent API endpoints (all `/api/agent/*` — enables Pi integration)
5. Dashboard page (live monitoring with 10s polling)
6. Batches page (list + detail with timeline)
7. Analytics page (profit charts, yield curves, KPIs)
8. Scheduler page (calendar + smart scheduler with Claude)
9. AI Chat page (conversational interface with farm context injection)
10. Settings page (farm/zone config, API keys, users)
11. Pi agent v14 module (`pi-agent/api_sync.py` + `ml_inference.py`)

## Key Files Reference

- `agrivision_build_spec.md` — Full detailed specification with API request/response examples, page layouts, and Prisma schema
- `prisma/schema.prisma` — Database schema (source of truth for all data models)
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/auth.ts` — NextAuth configuration
- `src/lib/api-key.ts` — Agent API key validation
- `src/lib/claude.ts` — Claude API helper with farm context injection

## Context for AI Chat Implementation

When the user sends a message to `/api/chat`, construct a Claude system prompt that includes:
- Organization + farm + zone name
- Current sensor reading (latest from DB)
- Active batch summary (batch number, crop, phase, day X of Y, health score)
- Last 5 AI decisions (timestamp, type, reasoning — compressed)
- Last 5 ML vision results (mushroom count, weight estimate, growth rate)
- Historical averages (avg cycle time per crop, avg yield per bag, avg cost-per-gram)
- User's role (owner sees profit data, operator sees operational data)

Keep total context under 4000 tokens. Send summaries, not raw data:
- 24 hourly sensor averages (not 288 raw readings)
- 7 daily averages (not 2016 readings)
- Latest scan + 5 trend points (not all photos)
- Batch history as 1 row per completed batch

## Existing Python Agent (v13) Reference

The Pi agent is a single Python file (`mushroom_farm_agent_v13.py`) running async tasks:
- `task_sensor_control()` — reads ESP32, controls humidity via Tapo plugs
- `task_fresh_air()` — periodic fan cycles for CO2 control
- `task_photos()` — captures RGB+depth from RealSense, uploads to Google Drive
- `task_vision()` — sends photos to Claude API for analysis (to be replaced by local ONNX inference in v14)
- Telegram bot for remote commands (fruiting start, enable/disable auto)
- Flask dashboard on port 5555 (to be replaced by this cloud platform)

The v14 upgrade adds:
- `api_sync.py` — HTTP POST to cloud API on every sensor read, AI decision, and photo
- `ml_inference.py` — loads ONNX models, runs inference on RGB+D frames, outputs structured JSON
- Command polling from cloud API (replaces Telegram as primary control)
- Telegram + Google Sheets remain as fallbacks

## Pilot Partners

Three identified partners for testing:
1. **Mushu Mushrooms** (mushumushrooms.se) — 50m², direct integration, ready now. Lion's Mane, Oyster, Shiitake.
2. **Urban Seeds** (urbanseeds.se) — 30m² microgreens in Stockholm. Needs tent-in-farm setup.
3. **Nära** (nära.se) — 800m² industrial vertical farm. Needs tent-as-proxy clone.

## Business Model

SaaS tiers:
- Starter (€30/mo): 1 zone, AI monitoring, basic scheduling
- Pro (€100-200/mo): 5 zones, 3D vision, harvest optimizer, multi-crop
- Business (€500-1,500/mo): Unlimited zones, full scheduling, profit analytics, API
- OEM (custom): White-label for equipment manufacturers
