import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const farm = await prisma.farm.findFirst({
      where: { organizationId: session.user.organizationId },
      include: {
        zones: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            cameraType: true,
            sensorUrl: true,
            plugIds: true,
            agentStatus: true,
            currentPhase: true,
            agentLastSeen: true,
            autoMode: true,
            _count: {
              select: {
                batches: { where: { phase: { in: ["COLONIZATION", "FRUITING", "READY_TO_HARVEST"] } } },
              },
            },
          },
        },
      },
    });

    if (!farm) {
      return NextResponse.json({ error: "No farm found" }, { status: 404 });
    }

    return NextResponse.json({
      id: farm.id,
      name: farm.name,
      address: farm.address,
      timezone: farm.timezone,
      electricityPriceKrPerKwh: farm.electricityPriceKrPerKwh,
      defaultSubstrateCostPerBag: farm.defaultSubstrateCostPerBag,
      defaultLaborCostPerBatch: farm.defaultLaborCostPerBatch,
      defaultMarketPrices: farm.defaultMarketPrices,
      zones: farm.zones.map((z: any) => ({
        ...z,
        activeBatchCount: z._count.batches,
        _count: undefined,
      })),
    });
  } catch (err) {
    console.error("Farm settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const {
      name, address, timezone,
      electricityPriceKrPerKwh, defaultSubstrateCostPerBag,
      defaultLaborCostPerBatch, defaultMarketPrices,
    } = await request.json();

    const farm = await prisma.farm.findFirst({
      where: { organizationId: session.user.organizationId },
    });

    if (!farm) {
      return NextResponse.json({ error: "No farm found" }, { status: 404 });
    }

    const updated = await prisma.farm.update({
      where: { id: farm.id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(timezone !== undefined && { timezone }),
        ...(electricityPriceKrPerKwh !== undefined && { electricityPriceKrPerKwh }),
        ...(defaultSubstrateCostPerBag !== undefined && { defaultSubstrateCostPerBag }),
        ...(defaultLaborCostPerBatch !== undefined && { defaultLaborCostPerBatch }),
        ...(defaultMarketPrices !== undefined && { defaultMarketPrices }),
      },
    });

    return NextResponse.json({ id: updated.id, name: updated.name });
  } catch (err) {
    console.error("Farm update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
