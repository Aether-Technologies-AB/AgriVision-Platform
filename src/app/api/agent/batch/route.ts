import { NextRequest, NextResponse } from "next/server";
import { BatchPhase, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

const VALID_PHASES = new Set<BatchPhase>([
  BatchPhase.PLANNED,
  BatchPhase.COLONIZATION,
  BatchPhase.FRUITING,
  BatchPhase.READY_TO_HARVEST,
  BatchPhase.HARVESTED,
  BatchPhase.CANCELLED,
  BatchPhase.GERMINATION,
  BatchPhase.POST_GERMINATION,
  BatchPhase.ACTIVE_GROWING,
  BatchPhase.PRE_HARVEST,
]);

// Pi microgreens agent sends phase as integer 1-4 (same convention as
// /api/agent/decision). Accept either the enum string or the integer here so
// startup registration works regardless of which the agent has on hand.
const PHASE_INT_MAP: Record<number, BatchPhase> = {
  1: BatchPhase.GERMINATION,
  2: BatchPhase.POST_GERMINATION,
  3: BatchPhase.ACTIVE_GROWING,
  4: BatchPhase.PRE_HARVEST,
};

function coercePhase(raw: unknown): BatchPhase | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number" && PHASE_INT_MAP[raw]) return PHASE_INT_MAP[raw];
  if (typeof raw === "string") {
    const upper = raw.toUpperCase() as BatchPhase;
    if (VALID_PHASES.has(upper)) return upper;
  }
  return null;
}

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === "string" || typeof raw === "number") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const body = await request.json();
    const {
      zoneId,
      batchNumber,
      cropType,
      substrate,
      bagCount,
      phase,
      plantedAt,
      notes,
    } = body;

    if (!zoneId || !batchNumber || !cropType) {
      return NextResponse.json(
        { error: "zoneId, batchNumber, and cropType are required" },
        { status: 400 }
      );
    }

    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { farm: true },
    });

    if (!zone || zone.farm.organizationId !== apiKey!.organizationId) {
      return NextResponse.json(
        { error: "Zone not found or access denied" },
        { status: 403 }
      );
    }

    const resolvedPhase = coercePhase(phase);
    if (phase !== undefined && phase !== null && !resolvedPhase) {
      return NextResponse.json(
        { error: `Invalid phase: ${phase}` },
        { status: 400 }
      );
    }

    // If a batch already exists with this batchNumber, it must live in the same
    // org — otherwise return 403 instead of silently overwriting cross-tenant.
    const existing = await prisma.batch.findUnique({
      where: { batchNumber },
      include: { zone: { include: { farm: true } } },
    });

    if (existing && existing.zone.farm.organizationId !== apiKey!.organizationId) {
      return NextResponse.json(
        { error: "batchNumber already exists in another organization" },
        { status: 403 }
      );
    }

    const planted = parseDate(plantedAt);

    const createData: Prisma.BatchUncheckedCreateInput = {
      batchNumber,
      zoneId,
      cropType,
      substrate: substrate ?? "straw",
      bagCount: typeof bagCount === "number" && bagCount > 0 ? bagCount : 1,
      phase: resolvedPhase ?? BatchPhase.PLANNED,
      plantedAt: planted,
      notes: typeof notes === "string" ? notes : null,
    };

    // On update, only overwrite fields the caller explicitly supplied so the
    // Pi can ping this endpoint repeatedly on reboot without clobbering values
    // an operator set in the dashboard (e.g. bagCount, notes).
    const updateData: Prisma.BatchUncheckedUpdateInput = { zoneId, cropType };
    if (substrate !== undefined) updateData.substrate = substrate;
    if (typeof bagCount === "number" && bagCount > 0) updateData.bagCount = bagCount;
    if (resolvedPhase) updateData.phase = resolvedPhase;
    if (planted) updateData.plantedAt = planted;
    if (notes !== undefined) updateData.notes = notes;

    const batch = await prisma.batch.upsert({
      where: { batchNumber },
      create: createData,
      update: updateData,
    });

    return NextResponse.json(
      {
        id: batch.id,
        batchNumber: batch.batchNumber,
        cropType: batch.cropType,
        substrate: batch.substrate,
        bagCount: batch.bagCount,
        phase: batch.phase,
        plantedAt: batch.plantedAt,
        zoneId: batch.zoneId,
        created: !existing,
      },
      { status: existing ? 200 : 201 }
    );
  } catch (err) {
    console.error("Agent batch upsert error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET — let the Pi look up a batch by batchNumber (so it can fetch its DB id
// at startup without re-creating). Returns 404 if not found in this org.
export async function GET(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  const batchNumber = request.nextUrl.searchParams.get("batchNumber");
  if (!batchNumber) {
    return NextResponse.json(
      { error: "batchNumber query param required" },
      { status: 400 }
    );
  }

  const batch = await prisma.batch.findUnique({
    where: { batchNumber },
    include: { zone: { include: { farm: true } } },
  });

  if (!batch || batch.zone.farm.organizationId !== apiKey!.organizationId) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: batch.id,
    batchNumber: batch.batchNumber,
    cropType: batch.cropType,
    substrate: batch.substrate,
    bagCount: batch.bagCount,
    phase: batch.phase,
    plantedAt: batch.plantedAt,
    zoneId: batch.zoneId,
  });
}
