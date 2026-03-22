import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const range = request.nextUrl.searchParams.get("range") || "30d";
    const rangeMs: Record<string, number> = {
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      "90d": 90 * 24 * 60 * 60 * 1000,
    };
    const since = new Date(Date.now() - (rangeMs[range] || rangeMs["30d"]));

    // Get farm for the org
    const farm = await prisma.farm.findFirst({
      where: { organizationId: session.user.organizationId },
    });
    if (!farm) {
      return NextResponse.json({ error: "No farm" }, { status: 404 });
    }

    // All energy readings for the farm
    const readings = await prisma.energyReading.findMany({
      where: {
        farmId: farm.id,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: "asc" },
      select: { deviceName: true, kWh: true, costKr: true, timestamp: true },
    });

    // Daily consumption chart
    const daily: Record<string, number> = {};
    let totalKwh = 0;
    let totalCostKr = 0;
    for (const r of readings) {
      const day = r.timestamp.toISOString().split("T")[0];
      daily[day] = (daily[day] || 0) + r.kWh;
      totalKwh += r.kWh;
      totalCostKr += r.costKr || 0;
    }
    const dailyChart = Object.entries(daily)
      .map(([date, kWh]) => ({ date, kWh: Math.round(kWh * 1000) / 1000 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // This month's cost
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthReadings = readings.filter(
      (r) => r.timestamp >= monthStart
    );
    const monthCostKr = monthReadings.reduce(
      (s, r) => s + (r.costKr || 0),
      0
    );

    // Cost breakdown from completed batches (energy vs substrate vs labor)
    const harvests = await prisma.harvest.findMany({
      where: {
        batch: {
          zone: { farm: { organizationId: session.user.organizationId } },
        },
      },
      select: {
        energyCost: true,
        substrateCost: true,
        laborCost: true,
        weightKg: true,
      },
    });
    const costBreakdown = {
      energy: harvests.reduce((s, h) => s + (h.energyCost || 0), 0),
      substrate: harvests.reduce((s, h) => s + (h.substrateCost || 0), 0),
      labor: harvests.reduce((s, h) => s + (h.laborCost || 0), 0),
    };
    const totalHarvestKg = harvests.reduce((s, h) => s + (h.weightKg || 0), 0);
    const energyCostPerKg =
      totalHarvestKg > 0 ? costBreakdown.energy / totalHarvestKg : 0;

    return NextResponse.json({
      dailyChart,
      totalKwh: Math.round(totalKwh * 1000) / 1000,
      totalCostKr: Math.round(totalCostKr * 100) / 100,
      monthCostKr: Math.round(monthCostKr * 100) / 100,
      energyCostPerKg: Math.round(energyCostPerKg * 100) / 100,
      costBreakdown,
    });
  } catch (err) {
    console.error("Analytics energy error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
