import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const range = request.nextUrl.searchParams.get("range") || "6m";
    const rangeMonths: Record<string, number> = { "3m": 3, "6m": 6, "1y": 12 };
    const months = rangeMonths[range] || 6;

    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const orgId = session.user.organizationId;

    // Completed batches with harvests
    const batches = await prisma.batch.findMany({
      where: {
        zone: { farm: { organizationId: orgId } },
        phase: "HARVESTED",
        harvestedAt: { gte: since },
      },
      include: {
        harvests: true,
        zone: { select: { name: true } },
      },
      orderBy: { harvestedAt: "asc" },
    });

    // Per-batch profit data
    const batchProfits = batches.map((b: any) => {
      const h = b.harvests[0];
      return {
        batchNumber: b.batchNumber,
        crop: b.cropType,
        zone: b.zone.name,
        yieldKg: b.actualYieldKg,
        revenue: b.actualRevenue,
        totalCost: b.actualCost,
        profit: b.actualProfit,
        costPerGram: h?.costPerGram ?? null,
        qualityGrade: b.qualityGrade,
        harvestedAt: b.harvestedAt,
      };
    });

    // Monthly summary
    const monthlyMap = new Map<
      string,
      { revenue: number; totalCost: number; profit: number; energyCost: number; substrateCost: number; laborCost: number; count: number }
    >();

    for (const b of batches as any[]) {
      if (!b.harvestedAt) continue;
      const key = `${b.harvestedAt.getFullYear()}-${String(b.harvestedAt.getMonth() + 1).padStart(2, "0")}`;
      const existing = monthlyMap.get(key) || {
        revenue: 0, totalCost: 0, profit: 0,
        energyCost: 0, substrateCost: 0, laborCost: 0, count: 0,
      };
      const h = b.harvests[0];
      existing.revenue += b.actualRevenue || 0;
      existing.totalCost += b.actualCost || 0;
      existing.profit += b.actualProfit || 0;
      existing.energyCost += h?.energyCost || 0;
      existing.substrateCost += h?.substrateCost || 0;
      existing.laborCost += h?.laborCost || 0;
      existing.count += 1;
      monthlyMap.set(key, existing);
    }

    const monthlySummary = Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        ...data,
        avgCostPerGram:
          data.totalCost > 0 && data.revenue > 0
            ? data.totalCost / ((data.revenue / 150) * 1000) // approximate
            : null,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Trends: compare first half vs second half of period
    const mid = Math.floor(batches.length / 2);
    const firstHalf = batches.slice(0, mid);
    const secondHalf = batches.slice(mid);

    function avgCostPerGram(arr: any[]): number {
      const costs = arr.flatMap((b: any) => b.harvests.map((h: any) => h.costPerGram).filter(Boolean)) as number[];
      return costs.length > 0 ? costs.reduce((a: any, b: any) => a + b, 0) / costs.length : 0;
    }

    function avgYield(arr: any[]): number {
      const yields = arr.map((b: any) => b.actualYieldKg).filter(Boolean) as number[];
      return yields.length > 0 ? yields.reduce((a: any, b: any) => a + b, 0) / yields.length : 0;
    }

    function totalProfit(arr: any[]): number {
      return arr.reduce((s: any, b: any) => s + (b.actualProfit || 0), 0);
    }

    const cpgFirst = avgCostPerGram(firstHalf);
    const cpgSecond = avgCostPerGram(secondHalf);
    const yieldFirst = avgYield(firstHalf);
    const yieldSecond = avgYield(secondHalf);
    const profitFirst = totalProfit(firstHalf);
    const profitSecond = totalProfit(secondHalf);

    const trends = {
      costPerGramTrend:
        cpgFirst > 0 ? (cpgSecond - cpgFirst) / cpgFirst : 0,
      yieldTrend:
        yieldFirst > 0 ? (yieldSecond - yieldFirst) / yieldFirst : 0,
      profitTrend:
        profitFirst > 0 ? (profitSecond - profitFirst) / profitFirst : 0,
    };

    // Current month stats
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastMonth = new Date(now);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastMonthKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;

    const thisMonthData = monthlyMap.get(thisMonth);
    const lastMonthData = monthlyMap.get(lastMonthKey);

    // Active batches count
    const activeBatchCount = await prisma.batch.count({
      where: {
        zone: { farm: { organizationId: orgId } },
        phase: { in: ["COLONIZATION", "FRUITING", "READY_TO_HARVEST"] },
      },
    });

    // AI cost this month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const aiDecisions = await prisma.aIDecision.findMany({
      where: {
        batch: { zone: { farm: { organizationId: orgId } } },
        timestamp: { gte: monthStart },
        costKr: { not: null },
      },
      select: { costKr: true },
    });
    const aiCostThisMonth = aiDecisions.reduce(
      (s: number, d: any) => s + (d.costKr || 0),
      0
    );

    return NextResponse.json({
      batchProfits,
      monthlySummary,
      trends,
      kpis: {
        revenueThisMonth: thisMonthData?.revenue || 0,
        revenueTrend: lastMonthData?.revenue
          ? ((thisMonthData?.revenue || 0) - lastMonthData.revenue) / lastMonthData.revenue
          : null,
        profitThisMonth: thisMonthData?.profit || 0,
        profitTrend: lastMonthData?.profit
          ? ((thisMonthData?.profit || 0) - lastMonthData.profit) / lastMonthData.profit
          : null,
        avgCostPerGram: avgCostPerGram(batches),
        activeBatchCount,
        avgYieldPerBatch: avgYield(batches),
        aiCostThisMonth,
      },
    });
  } catch (err) {
    console.error("Analytics profit error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
