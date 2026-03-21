import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const farms = await prisma.farm.findMany({
      where: { organizationId: session.user.organizationId },
      select: {
        id: true,
        name: true,
        address: true,
        timezone: true,
        _count: { select: { zones: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      farms: farms.map((f: any) => ({
        id: f.id,
        name: f.name,
        address: f.address,
        timezone: f.timezone,
        zoneCount: f._count.zones,
      })),
    });
  } catch (err) {
    console.error("Farms list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
