"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface MonthlyData {
  month: string;
  revenue: number;
  energyCost: number;
  substrateCost: number;
  laborCost: number;
  profit: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-text">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          <span className="text-text-mid">{p.name}:</span>
          <span className="font-mono text-text">{p.value.toFixed(0)} kr</span>
        </p>
      ))}
    </div>
  );
}

export default function RevenueChart({ data }: { data: MonthlyData[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-text-dim">
        Complete more batches to see revenue trends here.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    month: d.month,
    Revenue: d.revenue,
    Energy: d.energyCost,
    Substrate: d.substrateCost,
    Labor: d.laborCost,
    Profit: d.profit,
  }));

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-text">
        Revenue vs Costs
      </h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2e25" />
            <XAxis
              dataKey="month"
              tick={{ fill: "#4a6b55", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#1e2e25" }}
            />
            <YAxis
              tick={{ fill: "#4a6b55", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v} kr`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "#8aaa96" }}
              iconSize={8}
            />
            <Bar dataKey="Revenue" fill="#4abe7b" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Energy" stackId="cost" fill="#e8a830" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Substrate" stackId="cost" fill="#3b82f6" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Labor" stackId="cost" fill="#a78bfa" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
