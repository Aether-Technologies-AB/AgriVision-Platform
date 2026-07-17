import { BatchPhase } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Phases that mean "not currently in progress" — everything else counts as
// active. Crop-agnostic blacklist so it covers mushroom AND microgreen phase
// sets without enumerating them. Do not switch this to a whitelist — one
// already exists in /api/batches (GET) and it silently excludes microgreen
// batches because it only lists mushroom phases.
const INACTIVE_PHASES: BatchPhase[] = [
  BatchPhase.PLANNED,
  BatchPhase.HARVESTED,
  BatchPhase.CANCELLED,
];

// Single source of truth for "the active batch in this zone." Resolves
// server-side so Pi agents never need batch awareness — they only send
// zoneId + timestamp. Two other inline definitions of "active" already exist
// (dashboard live route uses this same blacklist correctly; /api/batches GET
// uses a buggy whitelist) — both should eventually call this helper instead,
// but that refactor is out of scope here.
//
// AgriVision is one-active-batch-per-zone by design. If a zone somehow has
// more than one, that's an anomaly, not a supported case: this logs a
// warning and deterministically picks the most recently planted batch rather
// than failing the caller or guessing further. Never creates or fabricates a
// batch.
//
// Caller must have already verified zoneId belongs to the requesting
// org/farm — this helper does no tenancy check of its own.
export async function getActiveBatchId(zoneId: string): Promise<string | null> {
  const activeBatches = await prisma.batch.findMany({
    where: { zoneId, phase: { notIn: INACTIVE_PHASES } },
    select: { id: true, plantedAt: true, createdAt: true },
    orderBy: [
      { plantedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
  });

  if (activeBatches.length === 0) return null;

  if (activeBatches.length > 1) {
    console.warn(
      `getActiveBatchId: zone ${zoneId} has ${activeBatches.length} active batches ` +
        `(${activeBatches.map((b) => b.id).join(", ")}) — picking most recently planted.`
    );
  }

  return activeBatches[0].id;
}
