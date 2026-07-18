"use client";

import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Sprout } from "lucide-react";
import { usePolling } from "@/lib/use-polling";
import TraitSiteTable, { SiteSummary } from "./TraitSiteTable";

interface DayPoint {
  day: string;
  plantCount: number;
  volMedianCm3: number | null;
  volMaxCm3: number | null;
  volNadirMedianCm3: number | null;
  heightMeanMedianCm: number | null;
  heightMaxCm: number | null;
  coveragePct: number | null;
}

interface TraitData {
  zoneId: string;
  range: string;
  days: DayPoint[];
  sites: SiteSummary[];
}

// Daily rollup → x is the UTC calendar day. Trait cadence is per-day, so the
// shortest useful window is a week (24h would show ≤1 point).
const RANGES = ["7d", "30d", "90d"] as const;

function formatTick(ms: number): string {
  return new Date(ms).toLocaleDateString("sv-SE", {
    month: "short",
    day: "numeric",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const labelText =
    typeof label === "number"
      ? new Date(label).toLocaleDateString("sv-SE", {
          month: "short",
          day: "numeric",
        })
      : String(label);
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-text-mid">{labelText}</p>
      {payload.map((p: { name: string; value: number | null; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}:{" "}
          <span className="font-mono">
            {p.value === null || p.value === undefined ? "--" : p.value.toFixed(p.name === "Plants" ? 0 : 1)}
          </span>
        </p>
      ))}
    </div>
  );
}

export default function TraitGrowthChart({ zoneId }: { zoneId: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");

  const { data, isLoading } = usePolling<TraitData>({
    url: `/api/dashboard/traits/${zoneId}?range=${range}`,
    intervalMs: 60_000, // same cadence as EnvironmentChart
  });

  const days = data?.days ?? [];
  const sites = data?.sites ?? [];

  const chartData = days.map((d) => ({
    t: new Date(d.day).getTime(),
    Median: d.volMedianCm3,
    Max: d.volMaxCm3,
    Plants: d.plantCount,
  }));

  const empty = !isLoading && days.length === 0;

  return (
    <>
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-text">
            <Sprout className="h-4 w-4 text-green" />
            Canopy Growth
            <span className="ml-1 text-xs font-normal text-text-dim">
              measured (cm³)
            </span>
          </h3>
          <div className="flex gap-1">
            {RANGES.map((r) => (
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
        <div className="h-64">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-text-dim">
              Loading chart...
            </div>
          ) : empty ? (
            <div className="flex h-full items-center justify-center text-sm text-text-dim">
              No rail trait data in this range yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="gradCanopyMax" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4abe7b" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#4abe7b" stopOpacity={0} />
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
                  tickFormatter={formatTick}
                />
                {/* Left axis: canopy volume (cm³) */}
                <YAxis
                  yAxisId="vol"
                  tick={{ fill: "#4a6b55", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, "dataMax + 5"]}
                  tickFormatter={(v: number) => `${v}`}
                />
                {/* Right axis: plant count */}
                <YAxis
                  yAxisId="count"
                  orientation="right"
                  tick={{ fill: "#4a6b55", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  domain={[0, "dataMax + 1"]}
                />
                <Tooltip content={<CustomTooltip />} />
                {/* Faint band up to the daily max canopy volume */}
                <Area
                  yAxisId="vol"
                  type="monotone"
                  dataKey="Max"
                  stroke="none"
                  fill="url(#gradCanopyMax)"
                  connectNulls
                  isAnimationActive={false}
                />
                {/* Median canopy volume — the primary growth line */}
                <Line
                  yAxisId="vol"
                  type="monotone"
                  dataKey="Median"
                  stroke="#4abe7b"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                {/* Plant count — secondary line, right axis */}
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="Plants"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        {!empty && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-6 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green" />
              <span className="text-text-dim">Median volume (cm³)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green/30" />
              <span className="text-text-dim">Max (band)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber" />
              <span className="text-text-dim">Plants</span>
            </span>
          </div>
        )}
      </div>
      <TraitSiteTable sites={sites} />
    </>
  );
}
