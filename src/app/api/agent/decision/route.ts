import { NextRequest, NextResponse } from "next/server";
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

    // If batchId provided, verify it belongs to the key's organization
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
