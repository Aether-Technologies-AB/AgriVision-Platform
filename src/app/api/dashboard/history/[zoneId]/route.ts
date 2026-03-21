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

    // Verify zone belongs to user's org
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { farm: true },
    });

    if (!zone || zone.farm.organizationId !== session.user.organizationId) {
      return NextResponse.json(
        { error: "Zone not found" },
        { status: 404 }
      );
    }

    // Calculate time range
    const rangeMs: Record<string, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };

    const since = new Date(Date.now() - (rangeMs[range] || rangeMs["24h"]));

    const readings = await prisma.sensorReading.findMany({
      where: {
        zoneId,
        timestamp: { gte: since },
      },
      select: {
        timestamp: true,
        temperature: true,
        humidity: true,
        co2: true,
        vpd: true,
      },
      orderBy: { timestamp: "asc" },
    });

    return NextResponse.json({ readings, range });
  } catch (err) {
    console.error("Dashboard history error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
