import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const batches = await prisma.batch.findMany({
      where: {
        zone: { farm: { organizationId: session.user.organizationId } },
        phase: "HARVESTED",
      },
      include: {
        harvests: { take: 1 },
        zone: { select: { name: true } },
      },
      orderBy: { harvestedAt: "asc" },
    });

    const yieldData = batches.map((b) => {
      const h = b.harvests[0];
      const daysToHarvest =
        b.plantedAt && b.harvestedAt
          ? Math.floor(
              (b.harvestedAt.getTime() - b.plantedAt.getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : null;

      return {
        batchNumber: b.batchNumber,
        crop: b.cropType,
        zone: b.zone.name,
        yieldKg: b.actualYieldKg,
        costPerGram: h?.costPerGram ?? null,
        revenue: b.actualRevenue,
        totalCost: b.actualCost,
        profit: b.actualProfit,
        qualityGrade: b.qualityGrade,
        daysToHarvest,
        harvestedAt: b.harvestedAt,
        energyCost: h?.energyCost ?? null,
      };
    });

    return NextResponse.json({ batches: yieldData });
  } catch (err) {
    console.error("Analytics yield error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
