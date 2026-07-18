import { AgentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// How long without a signal before a zone's agent is considered stale. Kept
// identical to the original inline check in /api/agent/sensor — do not change
// without auditing every caller below.
const STALE_MS = 3600_000; // 1h

type LivenessZone = {
  id: string;
  agentLastSeen: Date | null;
  agentStatus: AgentStatus;
};

// Single source of truth for "mark this zone's edge agent as alive." Extracted
// verbatim from the sensor route so every edge-agent ingest path (sensor,
// observations/traits, photo, energy) reports liveness the same way.
//
// The write is intentionally SKIPPED while the zone is already ONLINE and not
// yet stale — the agent's last-seen only advances once it crosses the 1h
// staleness boundary or is recovering from OFFLINE/ERROR. This matches the
// pre-existing behavior exactly (it avoids a Zone update on every high-
// frequency push); it is NOT a precise "last packet" timestamp.
//
// Returns the pending prisma update so a caller batching writes (the sensor
// route) can push it into an existing Promise.all, or null when no write is
// needed. Callers that aren't batching should use markAgentSeen() instead.
export function agentSeenUpdate(
  zone: LivenessZone
): Promise<unknown> | null {
  const stale =
    !zone.agentLastSeen ||
    Date.now() - new Date(zone.agentLastSeen).getTime() > STALE_MS;

  if (stale || zone.agentStatus !== AgentStatus.ONLINE) {
    return prisma.zone.update({
      where: { id: zone.id },
      data: {
        agentStatus: AgentStatus.ONLINE,
        agentLastSeen: new Date(),
      },
    });
  }
  return null;
}

// Best-effort variant for routes that aren't batching writes. Awaits the
// liveness update if one is needed and swallows+logs any failure — updating
// liveness must never turn a successful ingest into an error response.
export async function markAgentSeen(zone: LivenessZone): Promise<void> {
  const write = agentSeenUpdate(zone);
  if (!write) return;
  try {
    await write;
  } catch (err) {
    console.error(`markAgentSeen failed for zone ${zone.id}:`, err);
  }
}
