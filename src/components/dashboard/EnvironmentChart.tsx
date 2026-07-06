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
import { usePolling } from "@/lib/use-polling";

interface Reading {
  timestamp: string;
  temperature: number;
  humidity: number;
  co2: number | null;
  vpd: number | null;
  ph: number | null;
  ec: number | null;
  waterTemp: number | null;
}

interface HistoryData {
  readings: Reading[];
  range: string;
}

// Optional water-chemistry series — only offered on zones that actually report
// them. Keyed by the dataKey used in chartData.
const WATER_SERIES = [
  { key: "pH", field: "ph" as const, color: "#a855f7", unit: "", axis: "ph", domain: [0, 14] as [number, number] },
  { key: "EC", field: "ec" as const, color: "#f59e0b", unit: " mS/cm", axis: "ec", domain: ["auto", "auto"] as ["auto", "auto"] },
  { key: "Water Temp", field: "waterTemp" as const, color: "#06b6d4", unit: "°C", axis: "wtemp", domain: ["dataMin - 1", "dataMax + 1"] as [string, string] },
];

const UNIT_BY_NAME: Record<string, string> = {
  Temperature: "°C",
  Humidity: "%",
  pH: "",
  EC: " mS/cm",
  "Water Temp": "°C",
};

function formatTime(timestamp: string, range: string): string {
  const d = new Date(timestamp);
  if (range === "24h") {
    return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("sv-SE", { month: "short", day: "numeric" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-text-mid">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-mono">{p.value.toFixed(1)}</span>
          {UNIT_BY_NAME[p.name] ?? ""}
        </p>
      ))}
    </div>
  );
}

export default function EnvironmentChart({ zoneId }: { zoneId: string }) {
  const [range, setRange] = useState("24h");
  // Which optional water series are toggled on. Empty = chart looks exactly
  // like the air-only version.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  const { data, isLoading } = usePolling<HistoryData>({
    url: `/api/dashboard/history/${zoneId}?range=${range}`,
    intervalMs: 60_000, // refresh chart every 60s
  });

  const readings = data?.readings ?? [];

  // Data-driven gate: only offer water series when this zone actually reports
  // water chemistry. Non-water zones (Mushu, Urban Seeds, …) → no toggles, no
  // extra axes, no legend entries — identical to before this change.
  const hasWater = readings.some(
    (r) => r.ph !== null || r.ec !== null || r.waterTemp !== null
  );

  const chartData = readings.map((r) => ({
    time: formatTime(r.timestamp, range),
    Temperature: r.temperature,
    Humidity: r.humidity,
    pH: r.ph,
    // DB stores native µS/cm; convert ÷1000 to mS/cm for display only.
    EC: r.ec != null ? r.ec / 1000 : null,
    "Water Temp": r.waterTemp,
  }));

  // Downsample for large datasets
  const maxPoints = range === "30d" ? 120 : range === "7d" ? 168 : chartData.length;
  const step = Math.max(1, Math.floor(chartData.length / maxPoints));
  const sampled = chartData.filter((_, i) => i % step === 0);

  const activeWaterSeries = hasWater
    ? WATER_SERIES.filter((s) => enabled[s.key])
    : [];

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Environment</h3>
        <div className="flex items-center gap-2">
          {/* Water series toggles — only on water-enabled zones */}
          {hasWater && (
            <div className="flex gap-1">
              {WATER_SERIES.map((s) => (
                <button
                  key={s.key}
                  onClick={() =>
                    setEnabled((e) => ({ ...e, [s.key]: !e[s.key] }))
                  }
                  className="rounded-md px-2 py-1 text-xs font-medium transition-colors"
                  style={
                    enabled[s.key]
                      ? { backgroundColor: `${s.color}26`, color: s.color }
                      : { color: "#4a6b55" }
                  }
                >
                  {s.key}
                </button>
              ))}
              <span className="mx-1 w-px bg-border" />
            </div>
          )}
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
      </div>
      <div className="h-64">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-dim">
            Loading chart...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sampled}>
              <defs>
                <linearGradient id="gradTemp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4abe7b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4abe7b" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradHumid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2e25" />
              <XAxis
                dataKey="time"
                tick={{ fill: "#4a6b55", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "#1e2e25" }}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="temp"
                tick={{ fill: "#4a6b55", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                domain={["dataMin - 1", "dataMax + 1"]}
                tickFormatter={(v: number) => `${v}°`}
              />
              <YAxis
                yAxisId="humid"
                orientation="right"
                tick={{ fill: "#4a6b55", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                domain={[70, 100]}
                tickFormatter={(v: number) => `${v}%`}
              />
              {/* Hidden axes for any toggled-on water series */}
              {activeWaterSeries.map((s) => (
                <YAxis
                  key={s.axis}
                  yAxisId={s.axis}
                  hide
                  domain={s.domain}
                />
              ))}
              <Tooltip content={<CustomTooltip />} />
              <Area
                yAxisId="temp"
                type="monotone"
                dataKey="Temperature"
                stroke="#4abe7b"
                fill="url(#gradTemp)"
                strokeWidth={2}
                dot={false}
              />
              <Area
                yAxisId="humid"
                type="monotone"
                dataKey="Humidity"
                stroke="#3b82f6"
                fill="url(#gradHumid)"
                strokeWidth={2}
                dot={false}
              />
              {activeWaterSeries.map((s) => (
                <Area
                  key={s.key}
                  yAxisId={s.axis}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  fill="none"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-6 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green" />
          <span className="text-text-dim">Temperature</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue" />
          <span className="text-text-dim">Humidity</span>
        </span>
        {activeWaterSeries.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-text-dim">{s.key}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
