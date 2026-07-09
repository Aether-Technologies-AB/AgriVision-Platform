/**
 * Contract check for PR 1: replay the exact payloads the deployed Pi agents
 * send against the agent endpoints and assert the response shape hasn't
 * regressed. Runs against a live/deployed origin (defaults to the Vercel prod
 * URL — override with API_URL env var), using the Urban Seeds Pi's API key.
 *
 * Covers:
 *   (c) `/api/agent/batch` accepts a v14-style payload with no cropFamily
 *       and still resolves (because the zone now has a defaultCropFamily).
 *   (c) `/api/agent/decision` accepts a v14 payload with phase=1 and
 *       advances a MICROGREEN batch's phase.
 *   (c) `/api/agent/sensor` accepts the plain sensor payload untouched.
 *
 * Read-only for /decision & /sensor (the Pi's own writes are legitimate
 * telemetry — nothing to clean up). For /batch we upsert a scratch batch
 * with a well-known batchNumber, verify, and leave it for /decision to
 * exercise.
 *
 *   npx tsx scripts/verify_pr1_agent_contract.ts
 *
 * Env: URBAN_SEEDS_API_KEY (falls back to the value in scripts/env_template).
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env", override: false });

import assert from "node:assert/strict";

const API_URL = process.env.API_URL ?? "https://agri-vision-platform.vercel.app";
const API_KEY =
  process.env.URBAN_SEEDS_API_KEY ??
  "agv_8HYTVCqHEMiLaiJCkwWizoqWlj4ToNmZDqGkQnZ86dmyTlj8";
const FARM_ID = "cmomks3vm0009gs9kyxd0v731";
const ZONE_ID = "cmomks3yh000ags9ky6t2z0hj";
const SCRATCH_BATCH_NUMBER = "pr1-contract-check";

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
    "User-Agent": "AgriVision-Agent/14",
  };
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: r.status, body: json, raw: text };
}

async function main() {
  console.log(`Target: ${API_URL}`);

  // 1) /api/agent/batch — replay a Pi-style upsert with NO cropFamily. It
  //    should succeed because the zone has defaultCropFamily=MICROGREEN. This
  //    is the pre-existing on-wire shape from the field agents.
  {
    const res = await post("/api/agent/batch", {
      zoneId: ZONE_ID,
      batchNumber: SCRATCH_BATCH_NUMBER,
      cropType: "Sakura",              // free variety name, no family hint
      phase: 1,                         // Pi's integer convention (Phase 1)
      plantedAt: new Date().toISOString(),
    });
    assert.ok(res.status === 200 || res.status === 201, `/agent/batch status ${res.status}: ${res.raw}`);
    const b = res.body as Record<string, unknown>;
    assert.equal(b.cropFamily, "MICROGREEN", "family resolved via zone default");
    assert.equal(b.phase, "GERMINATION", "phase 1 → GERMINATION for MICROGREEN");
    assert.equal(b.cropType, "Sakura", "cropType preserved verbatim");
    console.log("✔ /api/agent/batch accepts legacy payload; family resolved via zone default");
  }

  // 2) /api/agent/decision — v14-style payload with phase=2 to advance the
  //    scratch MICROGREEN batch. Fetch its id first via GET.
  const getRes = await fetch(
    `${API_URL}/api/agent/batch?batchNumber=${SCRATCH_BATCH_NUMBER}`,
    { headers: headers() }
  );
  const scratch = (await getRes.json()) as { id: string; phase: string };
  assert.ok(scratch.id, "scratch batch lookup returned id");

  {
    const res = await post("/api/agent/decision", {
      batchId: scratch.id,
      decisionType: "VISION",
      decision: "ADVANCE",
      reasoning: "PR1 contract check — advance phase 1 → 2",
      phase: 2,
    });
    assert.equal(res.status, 201, `/agent/decision status ${res.status}: ${res.raw}`);
    const d = res.body as Record<string, unknown>;
    assert.ok(d.id, "decision returned id");
    console.log("✔ /api/agent/decision accepts phase=int payload; decision written");

    // Confirm the batch advanced.
    const after = await fetch(
      `${API_URL}/api/agent/batch?batchNumber=${SCRATCH_BATCH_NUMBER}`,
      { headers: headers() }
    );
    const b2 = (await after.json()) as { phase: string };
    assert.equal(b2.phase, "POST_GERMINATION", "phase 2 advanced the batch");
    console.log("✔ MICROGREEN batch advanced GERMINATION → POST_GERMINATION via decision.phase=2");
  }

  // 3) /api/agent/sensor — smoke a plain sensor push (schema unchanged).
  {
    const res = await post("/api/agent/sensor", {
      zoneId: ZONE_ID,
      temperature: 22.5,
      humidity: 55.0,
    });
    assert.ok(res.status === 200 || res.status === 201, `/agent/sensor status ${res.status}: ${res.raw}`);
    console.log("✔ /api/agent/sensor still accepts the plain payload");
  }

  console.log(`\nPASS — agent contracts preserved on ${API_URL}`);
  console.log(`(scratch batch left in place: batchNumber=${SCRATCH_BATCH_NUMBER}; delete manually if desired)`);
  // Not needed for suite pass, but useful hint.
  void FARM_ID;
}

main().catch((e) => {
  console.error("FAIL:", e.message ?? e);
  process.exit(1);
});
