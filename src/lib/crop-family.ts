import { BatchPhase, CropFamily } from "@prisma/client";

/**
 * Every legal (family, phase) pairing. The `SHARED` set applies to both
 * families; family-specific phases live under their own key. This is the
 * canonical source of truth — every guard (API validation, UI phase
 * progression, DB CHECK constraint in PR 3) reads from here.
 */
export const PHASES_BY_FAMILY: Record<CropFamily, ReadonlySet<BatchPhase>> = {
  [CropFamily.MUSHROOM]: new Set<BatchPhase>([
    BatchPhase.PLANNED,
    BatchPhase.COLONIZATION,
    BatchPhase.FRUITING,
    BatchPhase.READY_TO_HARVEST,
    BatchPhase.HARVESTED,
    BatchPhase.CANCELLED,
  ]),
  [CropFamily.MICROGREEN]: new Set<BatchPhase>([
    BatchPhase.PLANNED,
    BatchPhase.GERMINATION,
    BatchPhase.POST_GERMINATION,
    BatchPhase.ACTIVE_GROWING,
    BatchPhase.PRE_HARVEST,
    BatchPhase.HARVESTED,
    BatchPhase.CANCELLED,
  ]),
};

/**
 * Phases where a batch is neither pending (PLANNED) nor finished
 * (HARVESTED/CANCELLED). Used by the zone dashboard's active-batch lookup so
 * it stops filtering microgreens rows out.
 */
export const TERMINAL_OR_PENDING_PHASES: ReadonlySet<BatchPhase> = new Set([
  BatchPhase.PLANNED,
  BatchPhase.HARVESTED,
  BatchPhase.CANCELLED,
]);

/**
 * The first phase a batch enters when it starts (i.e. leaves PLANNED). Used
 * by the "start batch" UI and by the Pi's initial batch upsert.
 */
export const FIRST_ACTIVE_PHASE: Record<CropFamily, BatchPhase> = {
  [CropFamily.MUSHROOM]: BatchPhase.COLONIZATION,
  [CropFamily.MICROGREEN]: BatchPhase.GERMINATION,
};

export function isPhaseValidForFamily(
  family: CropFamily,
  phase: BatchPhase
): boolean {
  return PHASES_BY_FAMILY[family].has(phase);
}

/**
 * Static cropType → family map for the varieties we know about. Deliberately
 * conservative: unknown varieties return null (never a silent MUSHROOM
 * fallback) so callers can decide whether to try another inference source
 * (e.g. the zone default) or reject the request.
 *
 * Keys are compared case-insensitively so "Sakura" and "sakura" both hit.
 */
const CROP_TYPE_TO_FAMILY: Record<string, CropFamily> = {
  // Mushrooms
  oyster_blue: CropFamily.MUSHROOM,
  oyster_pink: CropFamily.MUSHROOM,
  oyster_yellow: CropFamily.MUSHROOM,
  oyster_grey: CropFamily.MUSHROOM,
  oyster_king: CropFamily.MUSHROOM,
  lions_mane: CropFamily.MUSHROOM,
  shiitake: CropFamily.MUSHROOM,
  reishi: CropFamily.MUSHROOM,
  chestnut: CropFamily.MUSHROOM,
  // Microgreens
  microgreens: CropFamily.MICROGREEN,
  "sakura-radish": CropFamily.MICROGREEN,
  sunflower: CropFamily.MICROGREEN,
  pea_shoots: CropFamily.MICROGREEN,
  radish: CropFamily.MICROGREEN,
  broccoli: CropFamily.MICROGREEN,
  kale: CropFamily.MICROGREEN,
  arugula: CropFamily.MICROGREEN,
};

export function familyFromCropType(cropType: string): CropFamily | null {
  return CROP_TYPE_TO_FAMILY[cropType.toLowerCase()] ?? null;
}

/**
 * Resolve the family for a new batch. Never guesses a family silently:
 *   1. Use the explicit value if provided.
 *   2. Fall back to a known cropType → family mapping.
 *   3. Fall back to the zone's default family.
 *   4. Return null — caller MUST reject the request with a clear error.
 */
export function resolveCropFamily(args: {
  explicit?: CropFamily | string | null;
  cropType?: string | null;
  zoneDefault?: CropFamily | null;
}): CropFamily | null {
  const { explicit, cropType, zoneDefault } = args;

  if (explicit) {
    const upper = String(explicit).toUpperCase();
    if (upper === CropFamily.MUSHROOM || upper === CropFamily.MICROGREEN) {
      return upper as CropFamily;
    }
  }

  if (cropType) {
    const inferred = familyFromCropType(cropType);
    if (inferred) return inferred;
  }

  if (zoneDefault) return zoneDefault;

  return null;
}
