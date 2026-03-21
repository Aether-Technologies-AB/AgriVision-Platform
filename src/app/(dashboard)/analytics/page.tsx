"use client";

import { useState, useEffect } from "react";
import { BarChart3, Zap } from "lucide-react";
import KPICards from "@/components/analytics/KPICards";
import RevenueChart from "@/components/analytics/RevenueChart";
import YieldCurve from "@/components/analytics/YieldCurve";
import BatchComparison from "@/components/analytics/BatchComparison";

interface ProfitData {
  batchProfits: {
    batchNumber: string;
    crop: string;
    zone: string;
    yieldKg: number | null;
    revenue: number | null;
    totalCost: number | null;
    profit: number | null;
    costPerGram: number | null;
    qualityGrade: string | null;
    harvestedAt: string | null;
  }[];
  monthlySummary: {
    month: string;
    revenue: number;
    energyCost: number;
    substrateCost: number;
    laborCost: number;
    profit: number;
  }[];
  kpis: {
    revenueThisMonth: number;
    revenueTrend: number | null;
    profitThisMonth: number;
    profitTrend: number | null;
    avgCostPerGram: number;
    activeBatchCount: number;
    avgYieldPerBatch: number;
    aiCostThisMonth: number;
  };
}

interface YieldData {
  batches: {
    batchNumber: string;
    crop: string;
    zone: string;
    yieldKg: number | null;
    costPerGram: number | null;
    revenue: number | null;
    totalCost: number | null;
    profit: number | null;
    qualityGrade: string | null;
    daysToHarvest: number | null;
    energyCost: number | null;
  }[];
}

type Range = "3m" | "6m" | "1y";

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("6m");
  const [profitData, setProfitData] = useState<ProfitData | null>(null);
  const [yieldData, setYieldData] = useState<YieldData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/analytics/profit?range=${range}`).then((r) => r.json()),
      fetch("/api/analytics/yield").then((r) => r.json()),
    ])
      .then(([profit, yields]) => {
        setProfitData(profit);
        setYieldData(yields);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [range]);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-green" />
          <h1 className="text-2xl font-semibold text-text">Analytics</h1>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-12 text-center text-sm text-text-dim">
          Loading analytics...
        </div>
      </div>
    );
  }

  // Compute energy efficiency stats
  const completedBatches = yieldData?.batches || [];
  const totalEnergyKr = completedBatches.reduce(
    (s, b) => s + (b.energyCost || 0),
    0
  );
  const totalYieldKg = completedBatches.reduce(
    (s, b) => s + (b.yieldKg || 0),
    0
  );
  const totalRevenue = completedBatches.reduce(
    (s, b) => s + (b.revenue || 0),
    0
  );
  const energyPerKg = totalYieldKg > 0 ? totalEnergyKr / totalYieldKg : 0;
  const energyPctRevenue = totalRevenue > 0 ? (totalEnergyKr / totalRevenue) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-green" />
          <h1 className="text-2xl font-semibold text-text">Analytics</h1>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-bg-card p-1">
          {(["3m", "6m", "1y"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r
                  ? "bg-green/15 text-green"
                  : "text-text-dim hover:text-text-mid"
              }`}
            >
              {r === "1y" ? "1 Year" : `${r.replace("m", " Months")}`}
            </button>
          ))}
        </div>
      </div>

      {/* Row 1: KPI Cards */}
      {profitData && <KPICards kpis={profitData.kpis} />}

      {/* Row 2: Revenue vs Costs */}
      <RevenueChart data={profitData?.monthlySummary || []} />

      {/* Row 3: Yield Improvement Curve */}
      <YieldCurve
        data={
          yieldData?.batches.map((b) => ({
            batchNumber: b.batchNumber,
            yieldKg: b.yieldKg,
            costPerGram: b.costPerGram,
          })) || []
        }
      />

      {/* Row 4: Batch Comparison Table */}
      <BatchComparison data={yieldData?.batches || []} />

      {/* Row 5: Energy Efficiency */}
      {completedBatches.length > 0 && totalEnergyKr > 0 && (
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber" />
            <h3 className="text-sm font-medium text-text">
              Energy Efficiency
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-text-dim">Avg Energy Cost / kg</p>
              <p className="font-mono text-xl font-semibold text-text">
                {energyPerKg.toFixed(1)}{" "}
                <span className="text-sm text-text-dim">kr/kg</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-text-dim">Energy as % of Revenue</p>
              <p className="font-mono text-xl font-semibold text-text">
                {energyPctRevenue.toFixed(1)}
                <span className="text-sm text-text-dim">%</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-text-dim">Total Energy Cost</p>
              <p className="font-mono text-xl font-semibold text-text">
                {totalEnergyKr.toFixed(0)}{" "}
                <span className="text-sm text-text-dim">kr</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {completedBatches.length === 0 && (
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber" />
            <h3 className="text-sm font-medium text-text">
              Energy Efficiency
            </h3>
          </div>
          <p className="mt-2 text-sm text-text-dim">
            Complete batches with energy cost data to see efficiency metrics.
          </p>
        </div>
      )}
    </div>
  );
}
