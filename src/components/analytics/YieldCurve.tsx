"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface BatchYield {
  batchNumber: string;
  yieldKg: number | null;
  costPerGram: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-text">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}:{" "}
          <span className="font-mono">
            {p.name === "Yield" ? `${p.value.toFixed(1)} kg` : `${p.value.toFixed(3)} kr/g`}
          </span>
        </p>
      ))}
    </div>
  );
}

export default function YieldCurve({ data }: { data: BatchYield[] }) {
  if (data.length < 2) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-text-dim">
        Complete more batches to see yield improvement trends here.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    batch: d.batchNumber,
    Yield: d.yieldKg ?? 0,
    "Cost/g": d.costPerGram ?? 0,
  }));

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-text">
        Yield Improvement Curve
      </h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2e25" />
            <XAxis
              dataKey="batch"
              tick={{ fill: "#4a6b55", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "#1e2e25" }}
            />
            <YAxis
              yAxisId="yield"
              tick={{ fill: "#4a6b55", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v} kg`}
            />
            <YAxis
              yAxisId="cpg"
              orientation="right"
              tick={{ fill: "#4a6b55", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v.toFixed(2)}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              yAxisId="yield"
              type="monotone"
              dataKey="Yield"
              stroke="#4abe7b"
              strokeWidth={2}
              dot={{ fill: "#4abe7b", r: 4 }}
            />
            <Line
              yAxisId="cpg"
              type="monotone"
              dataKey="Cost/g"
              stroke="#e8a830"
              strokeWidth={2}
              dot={{ fill: "#e8a830", r: 4 }}
              strokeDasharray="5 5"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-center gap-6 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green" />
          <span className="text-text-dim">Yield (kg)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber" />
          <span className="text-text-dim">Cost/gram (kr)</span>
        </span>
      </div>
    </div>
  );
}
