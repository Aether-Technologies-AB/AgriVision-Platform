import { NextRequest, NextResponse } from "next/server";
import { BatchPhase, CropFamily } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateApiKey } from "@/lib/api-key";

const VALID_DECISION_TYPES = [
  "ENVIRONMENT",
  "VISION",
  "HARVEST",
  "SCHEDULE",
  "ALERT",
  "STRATEGIC",
] as const;

// Pi microgreens agent sends phase as integer 1-4. Mapping is only applied
// when the batch's cropFamily is MICROGREEN — a stray integer from a
// mushroom agent must not get mapped to a microgreens phase.
const MICROGREENS_PHASE_MAP: Record<number, BatchPhase> = {
  1: BatchPhase.GERMINATION,
  2: BatchPhase.POST_GERMINATION,
  3: BatchPhase.ACTIVE_GROWING,
  4: BatchPhase.PRE_HARVEST,
};

export async function POST(request: NextRequest) {
  const { error, apiKey } = await validateApiKey(request);
  if (error) return error;

  try {
    const {
      batchId,
      decisionType,
      decision,
      reasoning,
      actionTaken,
      sensorContext,
      mlContext,
      costKr,
      phase,
    } = await request.json();

    if (!decisionType || !decision || !reasoning) {
      return NextResponse.json(
        { error: "decisionType, decision, and reasoning are required" },
        { status: 400 }
      );
    }

    if (!VALID_DECISION_TYPES.includes(decisionType)) {
      return NextResponse.json(
        { error: `Invalid decisionType. Must be one of: ${VALID_DECISION_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // If batchId provided, verify it belongs to the key's organization.
    // When phase is also present and the batch is microgreens, advance Batch.phase.
    let resolvedBatch: { id: string; cropFamily: CropFamily | null } | null = null;
    if (batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { zone: { include: { farm: true } } },
      });

      if (!batch || batch.zone.farm.organizationId !== apiKey!.organizationId) {
        return NextResponse.json(
          { error: "Batch not found or access denied" },
          { status: 403 }
        );
      }
      resolvedBatch = { id: batch.id, cropFamily: batch.cropFamily };
    }

    if (phase !== undefined && resolvedBatch) {
      const mapped = MICROGREENS_PHASE_MAP[phase as number];
      if (mapped && resolvedBatch.cropFamily === CropFamily.MICROGREEN) {
        await prisma.batch.update({
          where: { id: resolvedBatch.id },
          data: { phase: mapped },
        });
      }
      // Silent no-op for non-microgreen batches or out-of-range integers —
      // mushroom agents that send a stray `phase` field must not be rejected.
    }

    const aiDecision = await prisma.aIDecision.create({
      data: {
        batchId: batchId ?? null,
        decisionType,
        decision,
        reasoning,
        actionTaken: actionTaken ?? null,
        sensorContext: sensorContext ?? null,
        mlContext: mlContext ?? null,
        costKr: costKr ?? null,
      },
    });

    return NextResponse.json({ id: aiDecision.id }, { status: 201 });
  } catch (err) {
    console.error("Agent decision error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
