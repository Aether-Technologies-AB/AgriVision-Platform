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

// Dedicated water-chemistry chart (EZO probes), a matched pair to
// EnvironmentChart. pH (left axis) + EC (right axis, mS/cm) are the two a
// grower watches together; Water Temp is a toggleable third series on its own
// hidden axis. Colors match the water toggle-chips on EnvironmentChart.
const PH_COLOR = "#a855f7"; // purple
const EC_COLOR = "#f59e0b"; // amber
const WTEMP_COLOR = "#06b6d4"; // cyan

interface Reading {
  timestamp: string;
  ph: number | null;
  ec: number | null; // native µS/cm in the DB
  waterTemp: number | null;
}

interface HistoryData {
  readings: Reading[];
  range: string;
}

const UNIT_BY_NAME: Record<string, string> = {
  pH: "",
  EC: " mS/cm",
  "Water Temp": "°C",
};

const DECIMALS_BY_NAME: Record<string, number> = {
  pH: 2,
  EC: 2,
  "Water Temp": 1,
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
          {p.name}:{" "}
          <span className="font-mono">
            {p.value.toFixed(DECIMALS_BY_NAME[p.name] ?? 1)}
          </span>
          {UNIT_BY_NAME[p.name] ?? ""}
        </p>
      ))}
    </div>
  );
}

export default function WaterChart({ zoneId }: { zoneId: string }) {
  const [range, setRange] = useState("24h");
  const [showWaterTemp, setShowWaterTemp] = useState(true);

  const { data, isLoading } = usePolling<HistoryData>({
    url: `/api/dashboard/history/${zoneId}?range=${range}`,
    intervalMs: 60_000,
  });

  const readings = data?.readings ?? [];

  const chartData = readings.map((r) => ({
    time: formatTime(r.timestamp, range),
    pH: r.ph,
    // DB stores native µS/cm; convert ÷1000 to mS/cm for display only.
    EC: r.ec != null ? r.ec / 1000 : null,
    "Water Temp": r.waterTemp,
  }));

  // How many rows actually carry water chemistry — drives the empty state and
  // whether to show dots for thin data.
  const waterPointCount = readings.filter(
    (r) => r.ph !== null || r.ec !== null || r.waterTemp !== null
  ).length;

  // Downsample for large datasets (same policy as EnvironmentChart)
  const maxPoints = range === "30d" ? 120 : range === "7d" ? 168 : chartData.length;
  const step = Math.max(1, Math.floor(chartData.length / maxPoints));
  const sampled = chartData.filter((_, i) => i % step === 0);

  // Thin data: make individual points visible instead of an invisible line.
  const showDots = waterPointCount < 10;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Water Chemistry</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWaterTemp((v) => !v)}
            className="rounded-md px-2 py-1 text-xs font-medium transition-colors"
            style={
              showWaterTemp
                ? { backgroundColor: `${WTEMP_COLOR}26`, color: WTEMP_COLOR }
                : { color: "#4a6b55" }
            }
          >
            Water Temp
          </button>
          <span className="mx-1 w-px bg-border" />
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
        ) : waterPointCount === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-dim">
            No water data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sampled}>
              <defs>
                <linearGradient id="gradPh" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PH_COLOR} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={PH_COLOR} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradEc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={EC_COLOR} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={EC_COLOR} stopOpacity={0} />
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
              {/* LEFT: pH — auto-scaled tight around the data */}
              <YAxis
                yAxisId="ph"
                tick={{ fill: "#4a6b55", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                domain={["dataMin - 0.5", "dataMax + 0.5"]}
                tickFormatter={(v: number) => v.toFixed(1)}
              />
              {/* RIGHT: EC in mS/cm */}
              <YAxis
                yAxisId="ec"
                orientation="right"
                tick={{ fill: "#4a6b55", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                domain={[0, "dataMax + 0.5"]}
                tickFormatter={(v: number) => `${v.toFixed(1)}`}
              />
              {/* Hidden third axis for Water Temp so it never squashes pH/EC */}
              {showWaterTemp && (
                <YAxis
                  yAxisId="wtemp"
                  hide
                  domain={["dataMin - 1", "dataMax + 1"]}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              <Area
                yAxisId="ph"
                type="monotone"
                dataKey="pH"
                stroke={PH_COLOR}
                fill="url(#gradPh)"
                strokeWidth={2}
                dot={showDots}
                connectNulls
              />
              <Area
                yAxisId="ec"
                type="monotone"
                dataKey="EC"
                stroke={EC_COLOR}
                fill="url(#gradEc)"
                strokeWidth={2}
                dot={showDots}
                connectNulls
              />
              {showWaterTemp && (
                <Area
                  yAxisId="wtemp"
                  type="monotone"
                  dataKey="Water Temp"
                  stroke={WTEMP_COLOR}
                  fill="none"
                  strokeWidth={2}
                  dot={showDots}
                  connectNulls
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-6 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: PH_COLOR }}
          />
          <span className="text-text-dim">pH</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: EC_COLOR }}
          />
          <span className="text-text-dim">EC (mS/cm)</span>
        </span>
        {showWaterTemp && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: WTEMP_COLOR }}
            />
            <span className="text-text-dim">Water Temp</span>
          </span>
        )}
      </div>
      {waterPointCount < 2 && (
        <p className="mt-1 text-center text-[11px] text-text-dim">
          No trend data — need at least 2 readings
        </p>
      )}
    </div>
  );
}
