import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        zone: { select: { id: true, name: true, farmId: true, farm: { select: { organizationId: true, name: true } } } },
        harvests: { orderBy: { harvestedAt: "desc" }, take: 1 },
        _count: { select: { aiDecisions: true, scheduleEvents: true } },
      },
    });

    if (!batch || batch.zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Count photos for this zone during batch period
    const photoCount = await prisma.photo.count({
      where: {
        zoneId: batch.zoneId,
        ...(batch.plantedAt
          ? {
              timestamp: {
                gte: batch.plantedAt,
                ...(batch.harvestedAt ? { lte: batch.harvestedAt } : {}),
              },
            }
          : {}),
      },
    });

    let day: number | null = null;
    let estCycleDays: number | null = null;
    if (batch.plantedAt) {
      const ref = batch.harvestedAt || new Date();
      day = Math.floor(
        (ref.getTime() - batch.plantedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (batch.estHarvestDate) {
        estCycleDays = Math.floor(
          (batch.estHarvestDate.getTime() - batch.plantedAt.getTime()) /
            (1000 * 60 * 60 * 24)
        );
      }
    }

    return NextResponse.json({
      id: batch.id,
      batchNumber: batch.batchNumber,
      cropType: batch.cropType,
      substrate: batch.substrate,
      bagCount: batch.bagCount,
      phase: batch.phase,
      day,
      estCycleDays,
      plantedAt: batch.plantedAt,
      fruitingAt: batch.fruitingAt,
      harvestedAt: batch.harvestedAt,
      estHarvestDate: batch.estHarvestDate,
      estYieldKg: batch.estYieldKg,
      estProfit: batch.estProfit,
      actualYieldKg: batch.actualYieldKg,
      actualRevenue: batch.actualRevenue,
      actualCost: batch.actualCost,
      actualProfit: batch.actualProfit,
      qualityGrade: batch.qualityGrade,
      healthScore: batch.healthScore,
      notes: batch.notes,
      createdAt: batch.createdAt,
      zone: { id: batch.zone.id, name: batch.zone.name },
      farmName: batch.zone.farm.name,
      harvest: batch.harvests[0] || null,
      counts: {
        decisions: batch._count.aiDecisions,
        events: batch._count.scheduleEvents,
        photos: photoCount,
      },
    });
  } catch (err) {
    console.error("Batch detail error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    // Verify batch belongs to user's org
    const batch = await prisma.batch.findUnique({
      where: { id },
      include: { zone: { include: { farm: true } } },
    });

    if (!batch || batch.zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Build update data from allowed fields
    const allowedFields = [
      "phase", "plantedAt", "fruitingAt", "harvestedAt",
      "estHarvestDate", "estYieldKg", "estProfit",
      "actualYieldKg", "actualRevenue", "actualCost", "actualProfit",
      "qualityGrade", "healthScore", "notes",
    ];

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (["plantedAt", "fruitingAt", "harvestedAt", "estHarvestDate"].includes(field) && body[field]) {
          data[field] = new Date(body[field]);
        } else {
          data[field] = body[field];
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.batch.update({
      where: { id },
      data,
    });

    return NextResponse.json({ id: updated.id, phase: updated.phase });
  } catch (err) {
    console.error("Batch update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
