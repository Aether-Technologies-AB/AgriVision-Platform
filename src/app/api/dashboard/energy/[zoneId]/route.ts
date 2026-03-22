import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ zoneId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { zoneId } = await params;
    const range = request.nextUrl.searchParams.get("range") || "24h";

    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { farm: true },
    });

    if (!zone || zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    // Calculate time window
    const now = new Date();
    const rangeMs: Record<string, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const since = new Date(now.getTime() - (rangeMs[range] || rangeMs["24h"]));

    // Get all readings for zone + farm-wide
    const readings = await prisma.energyReading.findMany({
      where: {
        OR: [
          { zoneId },
          { farmId: zone.farmId, zoneId: null },
        ],
        timestamp: { gte: since },
      },
      orderBy: { timestamp: "asc" },
      select: {
        deviceName: true,
        kWh: true,
        costKr: true,
        timestamp: true,
      },
    });

    // Group by device for summary
    const byDevice: Record<string, { kWh: number; costKr: number }> = {};
    for (const r of readings) {
      if (!byDevice[r.deviceName]) {
        byDevice[r.deviceName] = { kWh: 0, costKr: 0 };
      }
      byDevice[r.deviceName].kWh += r.kWh;
      byDevice[r.deviceName].costKr += r.costKr || 0;
    }

    // Group by hour/day for chart
    const bucketMs = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const timeSeries: Record<string, Record<string, number>> = {};

    for (const r of readings) {
      const bucketTime = new Date(
        Math.floor(r.timestamp.getTime() / bucketMs) * bucketMs
      ).toISOString();
      if (!timeSeries[bucketTime]) {
        timeSeries[bucketTime] = {};
      }
      timeSeries[bucketTime][r.deviceName] =
        (timeSeries[bucketTime][r.deviceName] || 0) + r.kWh;
    }

    const chart = Object.entries(timeSeries)
      .map(([time, devices]) => ({ time, ...devices }))
      .sort((a, b) => a.time.localeCompare(b.time));

    const totalKwh = readings.reduce((s, r) => s + r.kWh, 0);
    const totalCostKr = readings.reduce((s, r) => s + (r.costKr || 0), 0);

    return NextResponse.json({
      totalKwh: Math.round(totalKwh * 1000) / 1000,
      totalCostKr: Math.round(totalCostKr * 100) / 100,
      byDevice: Object.entries(byDevice).map(([name, data]) => ({
        device: name,
        kWh: Math.round(data.kWh * 1000) / 1000,
        costKr: Math.round(data.costKr * 100) / 100,
      })),
      chart,
      range,
    });
  } catch (err) {
    console.error("Energy dashboard error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
