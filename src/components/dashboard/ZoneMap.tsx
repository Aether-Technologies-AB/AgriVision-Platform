"use client";

import Link from "next/link";
import { Wifi, WifiOff, AlertCircle } from "lucide-react";

interface ZoneBatch {
  id: string;
  batchNumber: string;
  cropType: string;
  phase: string;
  day: number | null;
  estCycleDays: number | null;
  healthScore: number | null;
}

interface ZoneMapData {
  id: string;
  name: string;
  agentStatus: string;
  agentLastSeen: string | null;
  currentPhase: string;
  batches: ZoneBatch[];
  sensor: {
    temperature: number;
    humidity: number;
    timestamp: string;
  } | null;
}

const cropLabels: Record<string, string> = {
  oyster_blue: "Blue Oyster",
  oyster_pink: "Pink Oyster",
  oyster_yellow: "Yellow Oyster",
  lions_mane: "Lion's Mane",
  shiitake: "Shiitake",
};

function getMaturityColor(batch: ZoneBatch): string {
  if (batch.phase === "HARVESTED") return "bg-text-dim/30";
  if (batch.phase === "PLANNED") return "bg-amber/40";
  if (batch.phase === "READY_TO_HARVEST") return "bg-green animate-pulse";

  // Gradient from amber (early) to green (near harvest) based on progress
  const progress =
    batch.day !== null && batch.estCycleDays && batch.estCycleDays > 0
      ? Math.min(1, batch.day / batch.estCycleDays)
      : 0;

  if (progress < 0.3) return "bg-amber/60";
  if (progress < 0.6) return "bg-amber/40 ring-1 ring-green/30";
  if (progress < 0.85) return "bg-green/50";
  return "bg-green/70";
}

function getMaturityLabel(batch: ZoneBatch): string {
  if (batch.phase === "PLANNED") return "Planned";
  if (batch.phase === "READY_TO_HARVEST") return "Ready!";
  if (batch.day !== null && batch.estCycleDays) {
    return `Day ${batch.day}/${batch.estCycleDays}`;
  }
  return batch.phase.replace(/_/g, " ").toLowerCase();
}

function formatAgo(ts: string | null): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ZoneMap({
  zones,
  onSelectZone,
}: {
  zones: ZoneMapData[];
  onSelectZone: (zoneId: string) => void;
}) {
  if (zones.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-8 text-center text-sm text-text-dim">
        No zones configured. Add zones in Settings.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-text">Facility Overview</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {zones.map((zone) => {
          const isOnline = zone.agentStatus === "ONLINE";
          const isError = zone.agentStatus === "ERROR";

          return (
            <button
              key={zone.id}
              onClick={() => onSelectZone(zone.id)}
              className="group rounded-xl border border-border bg-bg p-3.5 text-left transition-all hover:border-green/30 hover:bg-green/5"
            >
              {/* Zone header */}
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-sm font-semibold text-text group-hover:text-green">
                  {zone.name}
                </span>
                <div className="flex items-center gap-1.5">
                  {isOnline ? (
                    <Wifi className="h-3.5 w-3.5 text-green" />
                  ) : isError ? (
                    <AlertCircle className="h-3.5 w-3.5 text-red" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-text-dim" />
                  )}
                  <span
                    className={`text-[10px] ${
                      isOnline ? "text-green" : isError ? "text-red" : "text-text-dim"
                    }`}
                  >
                    {isOnline
                      ? formatAgo(zone.agentLastSeen)
                      : zone.agentStatus}
                  </span>
                </div>
              </div>

              {/* Batch blocks */}
              {zone.batches.length > 0 ? (
                <div className="mb-2.5 flex gap-1.5">
                  {zone.batches.map((batch) => (
                    <Link
                      key={batch.id}
                      href={`/batches/${batch.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className={`flex-1 rounded-lg px-2 py-2 text-center transition-colors hover:ring-1 hover:ring-green ${getMaturityColor(
                        batch
                      )}`}
                      title={`${batch.batchNumber} — ${cropLabels[batch.cropType] || batch.cropType}`}
                    >
                      <p className="text-[11px] font-semibold text-text">
                        {batch.batchNumber}
                      </p>
                      <p className="text-[9px] text-text-mid">
                        {getMaturityLabel(batch)}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="mb-2.5 rounded-lg border border-dashed border-border px-2 py-3 text-center text-[10px] text-text-dim">
                  No active batches
                </div>
              )}

              {/* Sensor footer */}
              {zone.sensor ? (
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="font-mono text-text">
                    {zone.sensor.temperature.toFixed(1)}°C
                  </span>
                  <span className="font-mono text-text">
                    {zone.sensor.humidity.toFixed(0)}% RH
                  </span>
                  <span className="ml-auto text-text-dim">
                    {formatAgo(zone.sensor.timestamp)}
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-text-dim">
                  {isOnline ? "No sensor data" : "OFFLINE"}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
