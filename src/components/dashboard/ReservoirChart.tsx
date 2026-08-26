"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Droplet } from "lucide-react";
import { usePolling } from "@/lib/use-polling";

// Refill-reservoir level chart (ultrasonic sensor, GGS Climate zone). The main
// reservoir is held constant by a float valve; the sensor is in the refill tank
// feeding it, so the trace falls as the crop draws water and jumps UP on a
// manual refill. The downward slope is transpiration / uptake.
const LEVEL_COLOR = "#38bdf8"; // sky blue — distinct from humidity/water-temp

interface Reading {
  timestamp: string;
  waterLevelL: number | null;
  waterLevelMm: number | null;
}

interface HistoryData {
  readings: Reading[];
  range: string;
}

function formatTick(ms: number, range: string): string {
  const d = new Date(ms);
  if (range === "24h") {
    return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("sv-SE", { month: "short", day: "numeric" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const labelText =
    typeof label === "number"
      ? new Date(label).toLocaleString("sv-SE", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : String(label);
  const p = payload[0];
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-text-mid">{labelText}</p>
      <p style={{ color: p.color }}>
        Reservoir: <span className="font-mono">{p.value.toFixed(1)}</span> L
      </p>
    </div>
  );
}

// Water consumed over the window = the sum of DOWNWARD level changes only.
// Refills push the level up; counting those would cancel out real uptake, so we
// ignore positive deltas. Returns litres consumed and the elapsed span in hours
// between the first and last valid reading (for the per-day rate).
function computeConsumption(points: { t: number; L: number }[]): {
  consumedL: number;
  spanHours: number;
} {
  let consumedL = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].L - points[i - 1].L;
    if (delta < 0) consumedL += -delta; // level dropped → water used
  }
  const spanHours =
    points.length >= 2
      ? (points[points.length - 1].t - points[0].t) / 3_600_000
      : 0;
  return { consumedL, spanHours };
}

export default function ReservoirChart({ zoneId }: { zoneId: string }) {
  const [range, setRange] = useState("24h");

  const { data, isLoading } = usePolling<HistoryData>({
    url: `/api/dashboard/history/${zoneId}?range=${range}`,
    intervalMs: 60_000,
  });

  const readings = data?.readings ?? [];

  // Only rows that actually carry a reservoir level. Numeric-time X-axis (same
  // rationale as EnvironmentChart) so bursty Pi pushes land at their real time.
  const points = readings
    .filter((r) => r.waterLevelL !== null)
    .map((r) => ({ t: new Date(r.timestamp).getTime(), L: r.waterLevelL as number }));

  const chartData = points.map((p) => ({ t: p.t, Reservoir: p.L }));

  // Downsample for large ranges (same policy as the sibling charts).
  const maxPoints = range === "30d" ? 120 : range === "7d" ? 168 : chartData.length;
  const step = Math.max(1, Math.floor(chartData.length / maxPoints));
  const sampled = chartData.filter((_, i) => i % step === 0);

  const { consumedL, spanHours } = computeConsumption(points);
  const ratePerDay = spanHours > 0 ? (consumedL / spanHours) * 24 : null;
  const latest = points.length ? points[points.length - 1].L : null;

  const showDots = points.length < 10;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplet className="h-4 w-4" style={{ color: LEVEL_COLOR }} />
          <h3 className="text-sm font-medium text-text">Refill Reservoir</h3>
        </div>
        <div className="flex gap-1">
          {(["24h", "7d", "30d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                range === r
                  ? "bg-green/15 text-green"
                  : "text-text-dim hover:text-text-mid"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Consumption summary — derived from the level trace over the window. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-2xl font-semibold text-text">
            {latest != null ? latest.toFixed(1) : "--"}
          </span>
          <span className="text-xs text-text-dim">L now</span>
        </span>
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-lg font-semibold" style={{ color: LEVEL_COLOR }}>
            {points.length >= 2 ? consumedL.toFixed(1) : "--"}
          </span>
          <span className="text-xs text-text-dim">L used ({range})</span>
        </span>
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-lg font-semibold" style={{ color: LEVEL_COLOR }}>
            {ratePerDay != null ? ratePerDay.toFixed(1) : "--"}
          </span>
          <span className="text-xs text-text-dim">L/day</span>
        </span>
      </div>

      <div className="h-56">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-dim">
            Loading chart...
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-dim">
            No reservoir data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sampled}>
              <defs>
                <linearGradient id="gradReservoir" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={LEVEL_COLOR} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={LEVEL_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2e25" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tick={{ fill: "#4a6b55", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "#1e2e25" }}
                tickFormatter={(v: number) => formatTick(v, range)}
              />
              <YAxis
                tick={{ fill: "#4a6b55", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                domain={["dataMin - 1", "dataMax + 1"]}
                tickFormatter={(v: number) => `${v.toFixed(0)}L`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="Reservoir"
                stroke={LEVEL_COLOR}
                fill="url(#gradReservoir)"
                strokeWidth={2}
                dot={showDots}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {points.length < 2 && points.length > 0 && (
        <p className="mt-1 text-center text-[11px] text-text-dim">
          No trend yet — need at least 2 readings to measure consumption
        </p>
      )}
    </div>
  );
}
