"use client";

import { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface EnergyData {
  totalKwh: number;
  totalCostKr: number;
  byDevice: { device: string; kWh: number; costKr: number }[];
  chart: Record<string, unknown>[];
}

const DEVICE_COLORS: Record<string, string> = {
  humidifier: "#3b82f6",
  fan: "#22c55e",
  light: "#eab308",
  "Main Humidifier": "#3b82f6",
  "Exhaust Fan": "#22c55e",
  "Grow Light": "#eab308",
};

export default function EnergyChart({ zoneId }: { zoneId: string }) {
  const [data, setData] = useState<EnergyData | null>(null);

  useEffect(() => {
    fetch(`/api/dashboard/energy/${zoneId}?range=24h`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [zoneId]);

  if (!data || data.chart.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber" />
          <span className="text-sm font-medium text-text">Energy (24h)</span>
        </div>
        <p className="mt-2 text-xs text-text-dim">No energy data yet</p>
      </div>
    );
  }

  const devices = data.byDevice.map((d) => d.device);

  const chartData = data.chart.map((point: Record<string, unknown>) => {
    const time = point.time as string;
    const d = new Date(time);
    return {
      ...point,
      label: d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }),
    };
  });

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber" />
          <span className="text-sm font-medium text-text">Energy (24h)</span>
        </div>
        <span className="text-xs text-text-dim">
          {data.totalKwh.toFixed(2)} kWh / {data.totalCostKr.toFixed(1)} kr
        </span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData} barCategoryGap="15%">
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 9, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            width={30}
          />
          <Tooltip
            contentStyle={{
              background: "#1a2420",
              border: "1px solid #2d3a34",
              borderRadius: 8,
              fontSize: 11,
            }}
            labelStyle={{ color: "#9ca3af" }}
          />
          <Legend
            iconSize={8}
            wrapperStyle={{ fontSize: 10 }}
          />
          {devices.map((device) => (
            <Bar
              key={device}
              dataKey={device}
              stackId="energy"
              fill={DEVICE_COLORS[device] || "#6b7280"}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
