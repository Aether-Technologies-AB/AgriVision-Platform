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
      include: { zone: { include: { farm: true } } },
    });

    if (!batch || batch.zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Sum energy readings for this zone during the batch duration
    const startDate = batch.plantedAt || batch.createdAt;
    const endDate = batch.harvestedAt || new Date();

    const result = await prisma.energyReading.aggregate({
      where: {
        zoneId: batch.zoneId,
        timestamp: { gte: startDate, lte: endDate },
      },
      _sum: { costKr: true, kWh: true },
    });

    // Also get proportional share of farm-wide energy (no zoneId)
    const farmWide = await prisma.energyReading.aggregate({
      where: {
        farmId: batch.zone.farmId,
        zoneId: null,
        timestamp: { gte: startDate, lte: endDate },
      },
      _sum: { costKr: true, kWh: true },
    });

    // Count active zones during this period for proportional share
    const zoneCount = await prisma.zone.count({
      where: { farmId: batch.zone.farmId },
    });

    const zoneCost = result._sum.costKr || 0;
    const farmShareCost = zoneCount > 0 ? (farmWide._sum.costKr || 0) / zoneCount : 0;
    const totalEnergyCost = zoneCost + farmShareCost;

    return NextResponse.json({
      energyCostKr: Math.round(totalEnergyCost * 100) / 100,
      zoneKwh: result._sum.kWh || 0,
      farmShareKwh: zoneCount > 0 ? (farmWide._sum.kWh || 0) / zoneCount : 0,
    });
  } catch (err) {
    console.error("Energy cost error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
