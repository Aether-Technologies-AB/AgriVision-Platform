# AgriVision AI — Full Platform Build Specification

## For use with Claude Code

---

## PROJECT OVERVIEW

AgriVision AI is an autonomous smart farming SaaS platform. It uses on-device ML models (fine-tuned from ImageNet, exported as ONNX for lightweight inference on Raspberry Pi), IoT sensors/actuators, and Claude AI for strategic decision-making to autonomously manage indoor crop production — starting with mushrooms, expanding to microgreens and leafy greens.

The platform we are building is the **cloud layer**: a Next.js web application that serves as the monitoring dashboard, batch management system, production scheduler, analytics engine, and AI chat interface. It receives data from edge devices (Raspberry Pi agents) running in each farm and presents it to farmers, operators, and investors.

There is already a working Python agent (v13) running on a Raspberry Pi 4 with an Intel RealSense D435 camera, ESP32 sensors, Tapo smart plugs, Google Sheets logging, Telegram alerts, and a basic Flask dashboard. This build creates the production replacement for that Flask dashboard and adds full SaaS capabilities.

---

## ARCHITECTURE

```
┌─────────────────────────────────────────────┐
│  TRAINING PIPELINE (offline, GPU)           │
│  ImageNet pretrained → fine-tune on crop    │
│  data → export ONNX (quantized INT8)        │
│  Runs on: Colab / local GPU / Hetzner       │
│  Models: 5-20 MB each after quantization    │
└──────────────┬──────────────────────────────┘
               │ .onnx model files (SCP or API pull)
               ▼
┌─────────────────────────────────────────────┐
│  RASPBERRY PI 4 (edge, one per farm/zone)   │
│                                              │
│  Hardware:                                   │
│  • Intel RealSense D435 (RGB 1280x720 +     │
│    depth 1280x720)                           │
│  • ESP32 sensors (temp, humidity, CO2)       │
│  • Tapo P110 smart plugs (humidifier, fan)  │
│  • Optional: Coral USB accelerator           │
│                                              │
│  Software (Python, async):                   │
│  ┌─────────────────────────────────────┐     │
│  │ Sensor Loop (every 5-10 min)       │     │
│  │ → Read ESP32 → rule-based control  │     │
│  │ → POST /api/agent/sensor           │     │
│  ├─────────────────────────────────────┤     │
│  │ ML Inference (every 4-6h)          │     │
│  │ → Capture RGB+D frame              │     │
│  │ → Run ONNX models locally:         │     │
│  │   • contamination_detector.onnx    │     │
│  │   • growth_stage_classifier.onnx   │     │
│  │   • pin_counter.onnx              │     │
│  │   • volume_estimator.onnx (RGB-D)  │     │
│  │   • weight_predictor.onnx          │     │
│  │ → POST /api/agent/vision           │     │
│  ├─────────────────────────────────────┤     │
│  │ Claude AI (2-4x daily)             │     │
│  │ → Receives structured ML outputs   │     │
│  │   (numbers, not photos)            │     │
│  │ → Strategic decisions:             │     │
│  │   harvest timing, profit calc,     │     │
│  │   scheduling, anomaly reasoning    │     │
│  │ → POST /api/agent/decision         │     │
│  ├─────────────────────────────────────┤     │
│  │ Photo Upload (every 4-6h)          │     │
│  │ → Upload RGB + depth to blob       │     │
│  │ → POST /api/agent/photo            │     │
│  ├─────────────────────────────────────┤     │
│  │ Command Poll (every 30s)           │     │
│  │ → GET /api/agent/commands          │     │
│  │ → Execute: start fruiting,         │     │
│  │   enable/disable auto, etc.        │     │
│  └─────────────────────────────────────┘     │
│                                              │
│  Fallbacks: Google Sheets + Telegram remain  │
└──────────────┬──────────────────────────────┘
               │ HTTPS (JSON + multipart)
               ▼
┌─────────────────────────────────────────────┐
│  VERCEL (cloud)                              │
│                                              │
│  Next.js 14 (App Router)                     │
│  ├── /app                                    │
│  │   ├── /(auth)/login, register, etc.       │
│  │   ├── /(dashboard)/                       │
│  │   │   ├── page.tsx         (live view)    │
│  │   │   ├── batches/         (management)   │
│  │   │   ├── scheduler/       (planning)     │
│  │   │   ├── analytics/       (profit/yield) │
│  │   │   ├── chat/            (AI assistant)  │
│  │   │   └── settings/        (config)       │
│  │   └── /api                                │
│  │       ├── /agent/*         (Pi endpoints)  │
│  │       ├── /dashboard/*     (frontend API)  │
│  │       ├── /chat            (Claude proxy)  │
│  │       └── /auth/*          (NextAuth)      │
│  ├── Prisma ORM                              │
│  └── Neon PostgreSQL                         │
│                                              │
│  Vercel Blob (camera image storage)          │
└─────────────────────────────────────────────┘
```

---

## TECH STACK

| Layer | Technology | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | Full-stack React, serverless API routes, Vercel-native |
| Language | TypeScript | Type safety across frontend + API |
| Styling | Tailwind CSS 3 | Utility-first, fast iteration, dark theme |
| Charts | Recharts | React-native, composable, lightweight |
| Icons | Lucide React | Clean, consistent, tree-shakeable |
| ORM | Prisma | Type-safe database access, migrations |
| Database | Neon PostgreSQL | Serverless Postgres, generous free tier, branching |
| Auth | NextAuth.js (Auth.js v5) | Session-based, multi-provider, built for Next.js |
| Image Storage | Vercel Blob | Simple, integrated with Vercel, presigned uploads |
| Real-time | Polling (10s interval) | Simple, reliable, no WebSocket infra needed at pilot scale |
| AI | Claude API (Anthropic) | Strategic reasoning, conversational interface |
| Deployment | Vercel | Zero-config Next.js hosting, free tier |
| Edge ML | ONNX Runtime (Python) | Lightweight inference on Pi, cross-platform |

---

## DATABASE SCHEMA (Prisma)

Create file: `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Multi-tenant root ───

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  plan      Plan     @default(STARTER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users  User[]
  farms  Farm[]
  apiKeys ApiKey[]
}

enum Plan {
  STARTER    // €30/mo — 1 zone
  PRO        // €100-200/mo — 5 zones
  BUSINESS   // €500-1500/mo — unlimited
}

model User {
  id             String       @id @default(cuid())
  email          String       @unique
  name           String?
  passwordHash   String
  role           UserRole     @default(OPERATOR)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime     @default(now())

  @@index([organizationId])
}

enum UserRole {
  OWNER
  OPERATOR
  VIEWER
}

model ApiKey {
  id             String       @id @default(cuid())
  name           String       // e.g. "Pi Agent - Zone A"
  keyHash        String       @unique
  prefix         String       // first 8 chars for identification
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  farmId         String?
  farm           Farm?        @relation(fields: [farmId], references: [id])
  lastUsedAt     DateTime?
  createdAt      DateTime     @default(now())

  @@index([keyHash])
  @@index([organizationId])
}

// ─── Farm structure ───

model Farm {
  id             String       @id @default(cuid())
  name           String
  address        String?
  timezone       String       @default("Europe/Stockholm")
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime     @default(now())

  zones   Zone[]
  apiKeys ApiKey[]

  @@index([organizationId])
}

model Zone {
  id       String @id @default(cuid())
  name     String // e.g. "Zone A", "Tent 1"
  farmId   String
  farm     Farm   @relation(fields: [farmId], references: [id])

  // Hardware config
  cameraType    String?  // "realsense_d435", "wyze_cam", "phone"
  sensorUrl     String?  // ESP32 endpoint
  plugIds       Json?    // Array of Tapo plug IPs/IDs

  // Current state (updated by agent)
  agentStatus   AgentStatus @default(OFFLINE)
  agentLastSeen DateTime?
  currentPhase  GrowthPhase @default(IDLE)
  autoMode      Boolean     @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  batches        Batch[]
  sensorReadings SensorReading[]
  photos         Photo[]
  deviceStates   DeviceState[]
  commands       Command[]

  @@index([farmId])
}

enum AgentStatus {
  ONLINE
  OFFLINE
  ERROR
}

enum GrowthPhase {
  IDLE
  COLONIZATION
  FRUITING
  HARVESTING
  DRYING
}

// ─── Core data ───

model Batch {
  id          String      @id @default(cuid())
  batchNumber String      // Human-readable, e.g. "B-2026-007"
  zoneId      String
  zone        Zone        @relation(fields: [zoneId], references: [id])

  // Crop info
  cropType    String      // "oyster_blue", "lions_mane", "shiitake", etc.
  substrate   String      @default("straw")
  bagCount    Int
  
  // Phase tracking
  phase       BatchPhase  @default(PLANNED)
  plantedAt   DateTime?
  fruitingAt  DateTime?
  harvestedAt DateTime?
  
  // Estimates (set by AI/scheduler)
  estHarvestDate DateTime?
  estYieldKg     Float?
  estProfit      Float?

  // Actuals (set after harvest)
  actualYieldKg  Float?
  actualRevenue  Float?
  actualCost     Float?
  actualProfit   Float?
  qualityGrade   String?   // "A", "B", "C"

  // Health tracking
  healthScore    Int?      // 0-100, updated by ML
  
  notes       String?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  aiDecisions AIDecision[]
  harvests    Harvest[]
  scheduleEvents ScheduleEvent[]

  @@unique([batchNumber])
  @@index([zoneId])
  @@index([phase])
}

enum BatchPhase {
  PLANNED
  COLONIZATION
  FRUITING
  READY_TO_HARVEST
  HARVESTED
  CANCELLED
}

model SensorReading {
  id        String   @id @default(cuid())
  zoneId    String
  zone      Zone     @relation(fields: [zoneId], references: [id])
  
  temperature Float
  humidity    Float
  co2         Int?
  vpd         Float?
  battery     Int?     // sensor battery %
  
  timestamp DateTime @default(now())

  @@index([zoneId, timestamp])
  @@index([timestamp])
}

model Photo {
  id       String @id @default(cuid())
  zoneId   String
  zone     Zone   @relation(fields: [zoneId], references: [id])

  rgbUrl     String   // Vercel Blob URL
  depthUrl   String?  // Depth map URL (optional)
  
  // ML analysis results (structured JSON from on-device inference)
  analysis   Json?    // { mushroom_count, pin_count, avg_diameter_cm, coverage_pct, contamination_risk, estimated_weight_g, growth_rate_cm3_day, ... }
  
  timestamp DateTime @default(now())

  @@index([zoneId, timestamp])
}

model AIDecision {
  id       String @id @default(cuid())
  batchId  String?
  batch    Batch?  @relation(fields: [batchId], references: [id])
  
  decisionType DecisionType
  decision     String        // e.g. "MIST_NOW", "WAIT", "HARVEST_TOMORROW"
  reasoning    String        // Claude's explanation in natural language
  actionTaken  String?       // What was actually executed
  
  // Context that was sent to Claude
  sensorContext  Json?       // Sensor data at time of decision
  mlContext      Json?       // ML model outputs at time of decision
  
  costKr         Float?     // Cost of this AI call in SEK
  
  timestamp DateTime @default(now())

  @@index([batchId, timestamp])
  @@index([decisionType])
  @@index([timestamp])
}

enum DecisionType {
  ENVIRONMENT    // humidity/temp/co2 control
  VISION         // photo analysis + growth assessment
  HARVEST        // harvest timing / profit optimization
  SCHEDULE       // production scheduling
  ALERT          // anomaly / emergency
  STRATEGIC      // daily strategic review
}

model Harvest {
  id       String @id @default(cuid())
  batchId  String
  batch    Batch  @relation(fields: [batchId], references: [id])

  weightKg      Float
  qualityGrade  String   // "A", "B", "C"
  pricePerKg    Float
  revenue       Float
  
  // Cost breakdown
  energyCost    Float?
  substrateCost Float?
  laborCost     Float?
  totalCost     Float?
  profit        Float?
  costPerGram   Float?   // Key metric: total cost / (weight * 1000)

  harvestedAt DateTime @default(now())

  @@index([batchId])
}

model ScheduleEvent {
  id       String @id @default(cuid())
  batchId  String?
  batch    Batch?  @relation(fields: [batchId], references: [id])

  eventType   ScheduleEventType
  title       String
  description String?
  scheduledAt DateTime
  completedAt DateTime?
  status      EventStatus @default(PENDING)

  createdAt DateTime @default(now())

  @@index([scheduledAt])
  @@index([status])
}

enum ScheduleEventType {
  INOCULATION
  PHASE_CHANGE
  VISION_CHECK
  HARVEST_WINDOW
  DELIVERY
  MAINTENANCE
  CUSTOM
}

enum EventStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  SKIPPED
  OVERDUE
}

model DeviceState {
  id       String @id @default(cuid())
  zoneId   String
  zone     Zone   @relation(fields: [zoneId], references: [id])

  deviceType  DeviceType
  deviceName  String      // e.g. "Humidifier Main", "Fan Exhaust"
  state       Boolean     // on/off
  lastToggled DateTime?
  
  updatedAt DateTime @updatedAt

  @@unique([zoneId, deviceType, deviceName])
  @@index([zoneId])
}

enum DeviceType {
  HUMIDIFIER
  FAN
  LIGHT
  HEATER
  PUMP
}

model Command {
  id     String @id @default(cuid())
  zoneId String
  zone   Zone   @relation(fields: [zoneId], references: [id])

  command    String   // "START_FRUITING", "ENABLE_AUTO", "DISABLE_AUTO", "FORCE_MIST", etc.
  payload    Json?    // Optional parameters
  status     CommandStatus @default(PENDING)
  issuedAt   DateTime @default(now())
  executedAt DateTime?
  result     String?

  @@index([zoneId, status])
}

enum CommandStatus {
  PENDING
  ACKNOWLEDGED
  EXECUTED
  FAILED
  EXPIRED
}

// ─── ML Model Registry ───

model MLModel {
  id          String @id @default(cuid())
  name        String    // "contamination_detector", "weight_predictor", etc.
  version     String    // "1.0.0"
  cropType    String    // "oyster", "lions_mane", "all"
  
  fileUrl     String    // URL to download .onnx file
  fileSizeMb  Float
  accuracy    Float?    // Validation accuracy
  
  // Training metadata
  trainedOn    String?  // "ImageNet + 2400 oyster photos"
  epochs       Int?
  
  isActive    Boolean   @default(false) // Which version is currently deployed
  createdAt   DateTime  @default(now())

  @@unique([name, version])
  @@index([name, isActive])
}
```

---

## API ENDPOINTS — DETAILED SPEC

### Agent API (called by Raspberry Pi, authenticated by API key)

All agent endpoints require header: `Authorization: Bearer <api_key>`

The API key is validated by hashing and looking up in the `ApiKey` table. The key maps to an organization and optionally a farm, which determines which zones the agent can write to.

#### `POST /api/agent/sensor`
Push a sensor reading. Called every 5-10 minutes.
```json
// Request
{
  "zoneId": "clxyz...",
  "temperature": 18.4,
  "humidity": 87.2,
  "co2": 680,
  "vpd": 0.44,
  "battery": 92
}
// Response: 201 Created
{ "id": "reading_id" }
```

#### `POST /api/agent/vision`
Push ML inference results from on-device models. Called every 4-6 hours.
```json
// Request
{
  "zoneId": "clxyz...",
  "batchId": "clxyz...",
  "analysis": {
    "mushroom_count": 12,
    "pin_count": 3,
    "avg_diameter_cm": 6.2,
    "cluster_volume_cm3": 142.5,
    "coverage_percent": 78.5,
    "contamination_risk": 0.02,
    "estimated_weight_g": 380,
    "growth_rate_cm3_day": 1.8,
    "harvest_readiness": 0.72,
    "quality_prediction": "A",
    "model_versions": {
      "contamination": "1.0.0",
      "growth_stage": "1.2.0",
      "weight": "1.1.0"
    }
  }
}
// Response: 201 Created
{ "id": "photo_analysis_id" }
```

#### `POST /api/agent/decision`
Push an AI decision (from Claude API call on Pi). Called 2-4x daily.
```json
// Request
{
  "batchId": "clxyz...",
  "decisionType": "HARVEST",
  "decision": "WAIT_2_DAYS",
  "reasoning": "Current weight 380g at A-grade. Projected +18g/day for 2 more days = 416g still A-grade. Revenue increase 5.4 kr vs additional cost 1.3 kr. Net gain +4.1 kr per bag. Recommend harvest March 26.",
  "actionTaken": "NO_ACTION",
  "sensorContext": { "temp": 18.4, "humidity": 87.2, "co2": 680 },
  "mlContext": { "weight_g": 380, "growth_rate": 1.8, "quality": "A" },
  "costKr": 0.25
}
// Response: 201 Created
{ "id": "decision_id" }
```

#### `POST /api/agent/photo`
Upload a camera image. Uses multipart form data.
```
POST /api/agent/photo
Content-Type: multipart/form-data

Fields:
  zoneId: "clxyz..."
  rgb: <file> (JPEG)
  depth: <file> (PNG, optional)
  analysis: <JSON string> (optional, same as vision endpoint)
```
The API uploads files to Vercel Blob and stores the URLs in the Photo table.

#### `GET /api/agent/commands?zoneId=clxyz...`
Poll for pending commands. Called every 30 seconds.
```json
// Response
{
  "commands": [
    {
      "id": "cmd_123",
      "command": "START_FRUITING",
      "payload": null,
      "issuedAt": "2026-03-20T14:00:00Z"
    }
  ]
}
```
Agent acknowledges by calling `PATCH /api/agent/commands/:id` with status update.

#### `PATCH /api/agent/commands/:id`
```json
// Request
{
  "status": "EXECUTED",
  "result": "Phase changed to FRUITING. Humidity target set to 85-90%."
}
```

#### `GET /api/agent/models?cropType=oyster`
Check for model updates. Called on agent startup and periodically.
```json
// Response
{
  "models": [
    {
      "name": "contamination_detector",
      "version": "1.0.0",
      "fileUrl": "https://blob.vercel-storage.com/models/contamination_v1.onnx",
      "fileSizeMb": 12.4
    }
  ]
}
```

---

### Dashboard API (called by frontend, authenticated by session)

#### `GET /api/dashboard/live/:zoneId`
Returns latest sensor reading + device states + agent status. Polled every 10s.
```json
{
  "sensor": { "temperature": 18.4, "humidity": 87.2, "co2": 680, "vpd": 0.44, "timestamp": "..." },
  "devices": [
    { "type": "HUMIDIFIER", "name": "Main", "state": true, "lastToggled": "..." },
    { "type": "FAN", "name": "Exhaust", "state": false, "lastToggled": "..." }
  ],
  "agent": { "status": "ONLINE", "lastSeen": "...", "autoMode": true, "phase": "FRUITING" },
  "latestPhoto": { "rgbUrl": "...", "timestamp": "..." },
  "activeBatch": { "id": "...", "batchNumber": "B-2026-007", "phase": "FRUITING", "day": 22 }
}
```

#### `GET /api/dashboard/history/:zoneId?range=24h|7d|30d`
Returns sensor time-series for charts.
```json
{
  "readings": [
    { "timestamp": "...", "temperature": 18.4, "humidity": 87.2, "co2": 680, "vpd": 0.44 },
    ...
  ]
}
```

#### `GET /api/batches?status=active|completed|all`
List batches with filters.

#### `POST /api/batches`
Create new batch.
```json
{
  "zoneId": "...",
  "cropType": "oyster_blue",
  "substrate": "straw",
  "bagCount": 12,
  "plantedAt": "2026-03-20T09:00:00Z",
  "notes": "New supplier substrate, testing yield difference"
}
```

#### `PATCH /api/batches/:id`
Update batch (phase change, harvest data, notes).

#### `GET /api/batches/:id/timeline`
Full event timeline: sensor readings, AI decisions, photos, phase changes — chronological.

#### `GET /api/analytics/profit?range=3m|6m|1y`
Profit analytics: per-batch profit, cost-per-gram trend, revenue vs costs.
```json
{
  "batchProfits": [
    { "batchNumber": "B-005", "crop": "Shiitake", "profit": 730, "costPerGram": 0.027, "yieldKg": 6.1 },
    ...
  ],
  "monthlySummary": [
    { "month": "2026-01", "revenue": 1600, "totalCost": 690, "profit": 910, "avgCostPerGram": 0.028 },
    ...
  ],
  "trends": {
    "costPerGramTrend": -0.12,  // -12% improvement
    "yieldTrend": 0.08,         // +8% improvement
    "profitTrend": 0.15          // +15% improvement
  }
}
```

#### `GET /api/analytics/yield`
Yield curves, energy-to-yield ratios, zone comparison.

#### `GET /api/schedule?from=...&to=...`
Upcoming scheduled events.

#### `POST /api/schedule`
Create scheduled event (manual or AI-suggested).

#### `POST /api/schedule/smart`
Smart scheduler: input delivery date + kg needed, AI calculates planting plan.
```json
// Request
{
  "deliveryDate": "2026-04-20",
  "quantityKg": 5.0,
  "cropType": "oyster_blue",
  "customerName": "Restaurant Norra"
}
// Response (AI-generated plan)
{
  "plan": {
    "plantDate": "2026-03-23",
    "zone": "Zone A",
    "bagCount": 10,
    "estHarvestDate": "2026-04-18",
    "bufferDays": 2,
    "confidence": 0.91,
    "reasoning": "Based on 6 previous oyster batches averaging 28-day cycle with 480g/bag yield. 10 bags × 0.48 kg = 4.8 kg + 2-day buffer for quality optimization. Zone A available from March 23."
  }
}
```

#### `POST /api/chat`
AI chat endpoint. Injects current farm context into Claude prompt.
```json
// Request
{ "message": "Should I harvest B-007 now or wait?" }
// Response (streamed)
{
  "response": "Based on current data for B-2026-007: your clusters are at an estimated 380g with A-grade quality and growing at 1.8 cm³/day. Here's the math:\n\n**Harvest today:** 380g × 150 kr/kg = 57 kr revenue − 24 kr costs = **33 kr profit**\n\n**Wait 2 days:** ~416g, still likely A-grade (93% confidence) = 62.4 kr − 25.3 kr = **37.1 kr profit**\n\n**Wait 5 days:** ~470g but quality drops to B-grade (68% probability) = 47 kr − 27 kr = **20 kr profit**\n\nMy recommendation: **wait 2 days** for +4.1 kr per bag (+12.4%). I'll run another check tomorrow to confirm quality trajectory."
}
```

#### `POST /api/commands/:zoneId`
Issue command to agent (user presses button in UI).
```json
{ "command": "START_FRUITING" }
```

---

## FRONTEND PAGES — DETAILED SPEC

### Design System

**Theme:** Dark mode, agricultural/organic feel. Not generic SaaS — think NASA mission control meets greenhouse.

**Color palette:**
- Background: `#0a0f0d` (near-black green)
- Cards: `#111916` with `#1e2e25` borders
- Primary green: `#4abe7b` (the AgriVision brand green from existing docs)
- Accent amber: `#e8a830` (warnings, highlights)
- Alert red: `#ef4444`
- Info blue: `#3b82f6`
- Text: `#e8f0eb` (primary), `#8aaa96` (secondary), `#4a6b55` (muted)

**Typography:** Use a monospace font for data values (JetBrains Mono or similar) and a clean sans-serif for labels (Outfit, which is already used in the existing AgriVision docs).

**Key design principles:**
- Data-dense but not cluttered. Every pixel should convey information.
- Real-time feel: subtle animations on data updates, pulsing status dots, live timestamps.
- Agricultural personality: use mushroom/plant emojis sparingly, organic rounded corners, growth-inspired gradients.

---

### Page 1: Dashboard (`/`)

The live monitoring command center. This is what a farmer sees when they open the app.

**Layout:**
- Top bar: Farm name, zone selector (dropdown), current time, agent status indicator (online/offline with last-seen time)
- Left column (60%): 
  - Sensor gauges row: 4 metric cards — Temperature (°C), Humidity (%), CO₂ (ppm), VPD (kPa). Each shows current value, trend arrow, and a small sparkline of last 2 hours.
  - Environment chart: Large area chart showing temp + humidity over last 24h (selectable: 24h/7d/30d). Dual Y-axis.
  - Active batch card: Current batch info — batch number, crop type, phase badge, day X of Y, progress bar, estimated harvest date, health score.
- Right column (40%):
  - Camera feed: Latest RGB photo from the Pi, with timestamp. Click to expand. Small link to depth map.
  - AI Decision Feed: Scrollable list of recent AI decisions with timestamp, icon by type, reasoning text. Newest first. Show last 10.
  - Device status: Humidifier ON/OFF, Fan ON/OFF, Light ON/OFF — with toggle buttons that issue commands. Auto/Manual mode toggle.

**Real-time behavior:** Poll `/api/dashboard/live/:zoneId` every 10 seconds. Animate value changes (count-up animation on numbers). Flash green on the status dot when data arrives.

---

### Page 2: Batches (`/batches`)

Batch lifecycle management — the core operational page.

**Layout:**
- Tab bar: Active | Completed | All | + New Batch button
- Batch table: Columns — Batch #, Crop, Zone, Phase (colored badge), Day, Est. Harvest, Health %, Yield (kg), Profit (kr). Sortable. Clickable rows.
- Click into a batch → Batch Detail page:
  - Header: Batch number, crop, zone, phase badge, created date
  - Stats row: Day X of Y, health score, est. yield, est. profit
  - Timeline: Vertical timeline of every event — phase changes, AI decisions, vision analyses, sensor anomalies, photos. Each with timestamp, icon, and expandable detail. This is the "flight recorder" of the batch.
  - Photo gallery: Grid of all photos taken during this batch, chronological. Click to expand with ML analysis overlay.
  - Actions: Change phase button, Mark as harvested (opens harvest data form), Add note, Cancel batch.

**New Batch form (modal or page):**
- Zone selector
- Crop type (dropdown: oyster_blue, oyster_pink, oyster_yellow, lions_mane, shiitake, custom)
- Substrate (straw, coffee_mix, sawdust, custom)
- Bag count (number input)
- Planned planting date (date picker)
- Notes (textarea)
- Submit → creates batch, sets phase to PLANNED

---

### Page 3: Scheduler (`/scheduler`)

Production planning and delivery scheduling.

**Layout:**
- Calendar view (monthly, with week view toggle): Shows all scheduled events as colored dots/blocks. Color by event type.
- Upcoming events list (sidebar): Next 14 days of events, with batch reference and status.
- Smart Scheduler panel (expandable): 
  - "Plan from delivery date" form: Delivery date, quantity (kg), crop type, customer name → Submit → AI calculates planting plan → Shows result card with recommended plant date, zone, bag count, confidence score, reasoning.
  - "Plan from planting date" form: Plant date, crop type, bag count → AI estimates harvest date and yield.
- Quick actions: "Schedule vision check", "Schedule harvest", "Add maintenance event"

---

### Page 4: Analytics (`/analytics`)

The ROI and optimization page — for the farmer AND for investor demos.

**Layout (scrollable, card-based):**

**Row 1 — KPI summary cards:**
- Total revenue (this month)
- Total profit (this month)
- Avg cost per gram (trending down = good)
- Active batches count
- Avg yield per batch (trending up = good)
- AI cost this month

**Row 2 — Revenue vs Costs chart:**
Stacked bar chart: energy + substrate + labor costs vs revenue, by month. Line overlay showing profit margin %.

**Row 3 — Yield improvement curve:**
Line chart: yield per batch over time (all batches). Shows the learning curve. Second line: cost-per-gram decreasing.

**Row 4 — Batch comparison table:**
All completed batches: batch #, crop, yield, revenue, cost, profit, cost/gram, days to harvest, quality grade. Sortable. Highlight best-performing batch.

**Row 5 — Zone performance:**
If multiple zones: side-by-side comparison of avg yield, avg profit, avg cycle time per zone.

**Row 6 — Energy analysis:**
Energy cost vs yield scatter plot. Identify which conditions produce highest profit per kWh.

---

### Page 5: AI Chat (`/chat`)

Conversational interface — the "ask your farm anything" page.

**Layout:** Full-page chat interface, similar to ChatGPT/Claude.ai.
- Message thread: Alternating user/AI messages. AI messages can contain formatted text, inline charts (small), and action buttons ("Run this analysis", "Schedule this").
- Input bar: Text input + send button. Pre-filled suggestions: "Should I harvest B-007?", "Schedule 5kg delivery for April 20", "Why is Zone B underperforming?", "Compare this month vs last month".
- Context indicator: Small bar above the chat showing what data the AI has access to: "Context: Zone A live sensors, B-2026-007 batch data, 6 months history"

**Implementation:** Frontend sends message to `/api/chat`. Backend constructs a Claude prompt that includes: current sensor data, active batch state, recent AI decisions, and the user's message. Streams the response back. Optionally supports function calling for actions (e.g., "create a schedule event" → AI calls the schedule API).

---

### Page 6: Settings (`/settings`)

Configuration and admin.

**Sections (tabbed or sidebar nav):**
- **Farm & Zones:** Edit farm name, timezone. Add/edit/remove zones. Configure hardware per zone (camera type, sensor URL, plug IDs).
- **API Keys:** Generate, view (prefix only), revoke API keys for Pi agents. Each key is scoped to a farm.
- **Users:** Invite users by email, set role (owner/operator/viewer), remove users. (Owner only.)
- **Notifications:** Toggle Telegram alerts, configure email notifications, set alert thresholds (e.g., "alert if humidity drops below 80%").
- **Billing:** Current plan, usage stats, upgrade path. (Placeholder for now.)
- **Models:** View deployed ML model versions per crop. Upload new model version. Set active version. (Advanced, for later.)

---

## BUILD ORDER (for Claude Code)

Execute these in order. Each step should be a working, testable increment.

### Step 1: Project Scaffold
```bash
npx create-next-app@latest agrivision-platform --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd agrivision-platform
npm install prisma @prisma/client
npm install next-auth @auth/prisma-adapter
npm install recharts lucide-react
npm install @vercel/blob
npm install bcryptjs
npm install -D @types/bcryptjs
npx prisma init
```
- Set up Tailwind dark theme config with the AgriVision color palette
- Create the layout with sidebar navigation
- Set up Prisma with the full schema above
- Configure environment variables: DATABASE_URL (Neon), NEXTAUTH_SECRET, ANTHROPIC_API_KEY

### Step 2: Database + Seed Data
- Run `npx prisma db push` to create tables on Neon
- Create `prisma/seed.ts` with realistic demo data: 1 organization, 1 farm, 3 zones, 5 batches (2 active, 2 completed, 1 planned), 48 hours of sensor readings, 10 AI decisions, 5 photos (placeholder URLs), scheduled events
- Verify with Prisma Studio: `npx prisma studio`

### Step 3: Auth
- Set up NextAuth with credentials provider (email + password)
- Create login and register pages
- Protect all dashboard routes with middleware
- Create API key validation middleware for agent endpoints

### Step 4: Agent API Endpoints
- Implement all `/api/agent/*` endpoints
- Test with curl/Postman using a generated API key
- This is the critical integration point — once these work, the Pi can start pushing data

### Step 5: Dashboard Page
- Build the live monitoring view
- Implement `/api/dashboard/live` and `/api/dashboard/history` endpoints
- Wire up 10-second polling
- Test with seed data

### Step 6: Batches Page
- Build batch list + detail views
- Implement CRUD endpoints
- Build the batch timeline component
- Build new batch form

### Step 7: Analytics Page
- Build all chart components
- Implement analytics query endpoints
- Wire up with historical batch/harvest data

### Step 8: Scheduler Page
- Build calendar view
- Implement schedule CRUD
- Build smart scheduler with Claude API integration

### Step 9: AI Chat Page
- Build chat UI
- Implement `/api/chat` with Claude context injection
- Add suggested prompts
- Test with real farm context

### Step 10: Settings Page
- Build all settings sections
- API key generation/management
- User management
- Zone configuration

### Step 11: Pi Agent v14 Module
- Create `api_sync.py` module for the existing Python agent
- Implements HTTP POST to all agent endpoints
- Add command polling loop
- Add ONNX inference runner (loads models, runs on captured frames, outputs structured JSON)
- Test end-to-end: Pi → Cloud → Dashboard

---

## ENVIRONMENT VARIABLES

```env
# Database
DATABASE_URL="postgresql://user:pass@ep-xxxx.us-east-2.aws.neon.tech/agrivision?sslmode=require"

# Auth
NEXTAUTH_SECRET="generate-a-random-secret-here"
NEXTAUTH_URL="http://localhost:3000"

# Anthropic (for AI chat + smart scheduler)
ANTHROPIC_API_KEY="sk-ant-..."

# Vercel Blob (for photo storage)
BLOB_READ_WRITE_TOKEN="vercel_blob_..."

# Optional: Telegram (for forwarding alerts from web UI)
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_CHAT_ID="..."
```

---

## FILE STRUCTURE

```
agrivision-platform/
├── prisma/
│   ├── schema.prisma          (full schema above)
│   └── seed.ts                (demo data)
├── src/
│   ├── app/
│   │   ├── layout.tsx         (root layout with sidebar)
│   │   ├── page.tsx           (dashboard - live monitoring)
│   │   ├── batches/
│   │   │   ├── page.tsx       (batch list)
│   │   │   └── [id]/page.tsx  (batch detail + timeline)
│   │   ├── scheduler/
│   │   │   └── page.tsx       (calendar + smart scheduler)
│   │   ├── analytics/
│   │   │   └── page.tsx       (charts + profit tracking)
│   │   ├── chat/
│   │   │   └── page.tsx       (AI assistant)
│   │   ├── settings/
│   │   │   └── page.tsx       (config + admin)
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── register/
│   │   │   └── page.tsx
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── agent/
│   │       │   ├── sensor/route.ts
│   │       │   ├── vision/route.ts
│   │       │   ├── decision/route.ts
│   │       │   ├── photo/route.ts
│   │       │   ├── commands/route.ts
│   │       │   └── models/route.ts
│   │       ├── dashboard/
│   │       │   ├── live/[zoneId]/route.ts
│   │       │   └── history/[zoneId]/route.ts
│   │       ├── batches/
│   │       │   ├── route.ts           (list + create)
│   │       │   └── [id]/
│   │       │       ├── route.ts       (get + update)
│   │       │       └── timeline/route.ts
│   │       ├── analytics/
│   │       │   ├── profit/route.ts
│   │       │   └── yield/route.ts
│   │       ├── schedule/
│   │       │   ├── route.ts           (list + create)
│   │       │   └── smart/route.ts     (AI scheduler)
│   │       ├── chat/route.ts
│   │       └── commands/[zoneId]/route.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   └── ZoneSelector.tsx
│   │   ├── dashboard/
│   │   │   ├── SensorCard.tsx
│   │   │   ├── EnvironmentChart.tsx
│   │   │   ├── ActiveBatchCard.tsx
│   │   │   ├── CameraFeed.tsx
│   │   │   ├── AIDecisionFeed.tsx
│   │   │   └── DeviceControl.tsx
│   │   ├── batches/
│   │   │   ├── BatchTable.tsx
│   │   │   ├── BatchTimeline.tsx
│   │   │   ├── BatchForm.tsx
│   │   │   └── PhotoGallery.tsx
│   │   ├── analytics/
│   │   │   ├── KPICards.tsx
│   │   │   ├── RevenueChart.tsx
│   │   │   ├── YieldCurve.tsx
│   │   │   └── BatchComparison.tsx
│   │   ├── scheduler/
│   │   │   ├── CalendarView.tsx
│   │   │   ├── EventList.tsx
│   │   │   └── SmartScheduler.tsx
│   │   ├── chat/
│   │   │   ├── ChatThread.tsx
│   │   │   └── ChatInput.tsx
│   │   └── ui/
│   │       ├── Badge.tsx
│   │       ├── MetricCard.tsx
│   │       ├── PhaseBar.tsx
│   │       ├── StatusDot.tsx
│   │       └── LoadingSpinner.tsx
│   ├── lib/
│   │   ├── prisma.ts          (Prisma client singleton)
│   │   ├── auth.ts            (NextAuth config)
│   │   ├── api-key.ts         (Agent API key validation)
│   │   ├── claude.ts          (Claude API helper with context injection)
│   │   └── utils.ts           (formatters, helpers)
│   └── types/
│       └── index.ts           (shared TypeScript types)
├── pi-agent/
│   ├── api_sync.py            (new: HTTP sync module)
│   ├── ml_inference.py        (new: ONNX model runner)
│   └── README.md              (integration instructions)
├── training/
│   ├── README.md              (training pipeline docs)
│   ├── notebooks/
│   │   ├── 01_data_prep.ipynb
│   │   ├── 02_finetune.ipynb
│   │   └── 03_export_onnx.ipynb
│   └── scripts/
│       └── export_onnx.py
├── .env.local                 (environment variables)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.js
```

---

## NOTES FOR CLAUDE CODE

- Start each step by verifying the previous step works. Don't skip ahead.
- Use `npx prisma studio` to visually verify database state after seeding.
- For the dashboard polling, use a custom React hook `usePolling(url, intervalMs)` that handles errors gracefully and shows stale-data indicators.
- All API routes should return proper HTTP status codes and error messages.
- Use Prisma's `include` and `select` to avoid N+1 queries. Use `@@index` hints in the schema.
- The AI chat context injection is critical — construct a system prompt that includes: org name, farm name, zone name, current sensor reading, active batch summary, last 5 AI decisions, and the user's role. Keep it under 4000 tokens.
- For the smart scheduler, use Claude with a structured prompt that includes historical batch data (avg cycle times per crop, avg yield per bag) to make accurate predictions.
- The agent API endpoints should validate the API key, check that the zone belongs to the key's farm, and return 403 if not. This prevents cross-farm data injection.
- For photo uploads, use Vercel Blob's `put()` function with the agent API key as context. Store the returned URL in the Photo table.
- All timestamps should be stored in UTC and displayed in the farm's timezone.
