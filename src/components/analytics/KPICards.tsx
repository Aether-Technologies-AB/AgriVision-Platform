"use client";

import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Layers,
  Weight,
  Brain,
} from "lucide-react";

interface KPIs {
  revenueThisMonth: number;
  revenueTrend: number | null;
  profitThisMonth: number;
  profitTrend: number | null;
  avgCostPerGram: number;
  activeBatchCount: number;
  avgYieldPerBatch: number;
  aiCostThisMonth: number;
}

function TrendBadge({
  value,
  invertColors,
}: {
  value: number | null;
  invertColors?: boolean;
}) {
  if (value === null || value === 0) {
    return (
      <span className="flex items-center gap-0.5 text-text-dim">
        <Minus className="h-3 w-3" />
        <span className="text-[10px]">--</span>
      </span>
    );
  }
  const pct = Math.abs(value * 100).toFixed(0);
  const isPositive = value > 0;
  const isGood = invertColors ? !isPositive : isPositive;

  return (
    <span className={`flex items-center gap-0.5 ${isGood ? "text-green" : "text-red"}`}>
      {isPositive ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      <span className="text-[10px]">
        {isPositive ? "+" : "-"}
        {pct}%
      </span>
    </span>
  );
}

function KPICard({
  label,
  value,
  suffix,
  trend,
  invertColors,
  icon,
}: {
  label: string;
  value: string;
  suffix?: string;
  trend?: number | null;
  invertColors?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text-dim">{label}</span>
        <span className="text-text-dim">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold text-text">
          {value}
        </span>
        {suffix && <span className="text-xs text-text-mid">{suffix}</span>}
      </div>
      {trend !== undefined && (
        <div className="mt-1.5">
          <TrendBadge value={trend ?? null} invertColors={invertColors} />
        </div>
      )}
    </div>
  );
}

export default function KPICards({ kpis }: { kpis: KPIs }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <KPICard
        label="Revenue (month)"
        value={kpis.revenueThisMonth.toFixed(0)}
        suffix="kr"
        trend={kpis.revenueTrend}
        icon={<DollarSign className="h-4 w-4" />}
      />
      <KPICard
        label="Profit (month)"
        value={kpis.profitThisMonth.toFixed(0)}
        suffix="kr"
        trend={kpis.profitTrend}
        icon={<TrendingUp className="h-4 w-4" />}
      />
      <KPICard
        label="Avg Cost/gram"
        value={kpis.avgCostPerGram > 0 ? kpis.avgCostPerGram.toFixed(3) : "--"}
        suffix="kr"
        invertColors
        icon={<Activity className="h-4 w-4" />}
      />
      <KPICard
        label="Active Batches"
        value={String(kpis.activeBatchCount)}
        icon={<Layers className="h-4 w-4" />}
      />
      <KPICard
        label="Avg Yield/batch"
        value={kpis.avgYieldPerBatch > 0 ? kpis.avgYieldPerBatch.toFixed(1) : "--"}
        suffix="kg"
        icon={<Weight className="h-4 w-4" />}
      />
      <KPICard
        label="AI Cost (month)"
        value={kpis.aiCostThisMonth.toFixed(1)}
        suffix="kr"
        icon={<Brain className="h-4 w-4" />}
      />
    </div>
  );
}
