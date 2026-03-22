"use client";

import { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

interface EnergyData {
  dailyChart: { date: string; kWh: number }[];
  totalKwh: number;
  totalCostKr: number;
  monthCostKr: number;
  energyCostPerKg: number;
  costBreakdown: { energy: number; substrate: number; labor: number };
}

const BREAKDOWN_COLORS = ["#eab308", "#22c55e", "#3b82f6"];

export default function EnergyAnalytics() {
  const [data, setData] = useState<EnergyData | null>(null);

  useEffect(() => {
    fetch("/api/analytics/energy?range=30d")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const breakdownData = [
    { name: "Energy", value: data.costBreakdown.energy, color: BREAKDOWN_COLORS[0] },
    { name: "Substrate", value: data.costBreakdown.substrate, color: BREAKDOWN_COLORS[1] },
    { name: "Labor", value: data.costBreakdown.labor, color: BREAKDOWN_COLORS[2] },
  ].filter((d) => d.value > 0);

  const totalBreakdown = breakdownData.reduce((s, d) => s + d.value, 0);

  function fmt(v: number, decimalsLarge = 1): string {
    if (v === 0) return "0";
    return v < 1 ? v.toFixed(3) : v.toFixed(decimalsLarge);
  }

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber" />
            <p className="text-xs text-text-dim">This Month</p>
          </div>
          <p className="mt-1 font-mono text-xl font-semibold text-text">
            {fmt(data.monthCostKr)}{" "}
            <span className="text-sm text-text-dim">kr</span>
          </p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs text-text-dim">Total (30d)</p>
          <p className="mt-1 font-mono text-xl font-semibold text-text">
            {fmt(data.totalKwh)}{" "}
            <span className="text-sm text-text-dim">kWh</span>
          </p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs text-text-dim">Energy Cost / kg</p>
          <p className="mt-1 font-mono text-xl font-semibold text-text">
            {data.energyCostPerKg > 0 ? fmt(data.energyCostPerKg) : "--"}{" "}
            <span className="text-sm text-text-dim">kr/kg</span>
          </p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs text-text-dim">Total Cost (30d)</p>
          <p className="mt-1 font-mono text-xl font-semibold text-text">
            {fmt(data.totalCostKr)}{" "}
            <span className="text-sm text-text-dim">kr</span>
          </p>
        </div>
      </div>

      {/* Consumption chart + cost breakdown side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Daily consumption */}
        <div className="rounded-xl border border-border bg-bg-card p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-medium text-text">
            Daily Energy Consumption
          </h3>
          {data.dailyChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.dailyChart}>
                <defs>
                  <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v.slice(5)}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  width={35}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1a2420",
                    border: "1px solid #2d3a34",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(v) => [`${Number(v).toFixed(3)} kWh`, "Energy"]}
                />
                <Area
                  type="monotone"
                  dataKey="kWh"
                  stroke="#eab308"
                  strokeWidth={2}
                  fill="url(#energyGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-xs text-text-dim">
              No energy data yet
            </p>
          )}
        </div>

        {/* Cost breakdown */}
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-text">
            Cost Breakdown
          </h3>
          {breakdownData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={breakdownData} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    axisLine={false}
                    tickLine={false}
                    width={65}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1a2420",
                      border: "1px solid #2d3a34",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    formatter={(v) => [`${Number(v).toFixed(0)} kr`, "Cost"]}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {breakdownData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {breakdownData.map((d) => (
                  <div
                    key={d.name}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: d.color }}
                      />
                      <span className="text-text-mid">{d.name}</span>
                    </div>
                    <span className="font-mono text-text">
                      {d.value.toFixed(0)} kr (
                      {totalBreakdown > 0
                        ? ((d.value / totalBreakdown) * 100).toFixed(0)
                        : 0}
                      %)
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-xs text-text-dim">
              Complete batches with cost data to see breakdown
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
