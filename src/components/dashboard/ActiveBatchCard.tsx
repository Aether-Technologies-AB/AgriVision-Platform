"use client";

import { Sprout, Calendar, TrendingUp, Heart } from "lucide-react";

interface BatchData {
  id: string;
  batchNumber: string;
  cropType: string;
  phase: string;
  day: number | null;
  estCycleDays: number | null;
  estHarvestDate: string | null;
  estYieldKg: number | null;
  healthScore: number | null;
}

const phaseColors: Record<string, string> = {
  PLANNED: "bg-text-dim/20 text-text-dim",
  COLONIZATION: "bg-blue/15 text-blue",
  FRUITING: "bg-green/15 text-green",
  READY_TO_HARVEST: "bg-amber/15 text-amber",
  HARVESTED: "bg-green-dim/20 text-green-dim",
  CANCELLED: "bg-red/15 text-red",
};

const cropLabels: Record<string, string> = {
  oyster_blue: "Blue Oyster",
  oyster_pink: "Pink Oyster",
  oyster_yellow: "Yellow Oyster",
  lions_mane: "Lion's Mane",
  shiitake: "Shiitake",
};

function formatDate(d: string | null): string {
  if (!d) return "--";
  return new Date(d).toLocaleDateString("sv-SE", {
    month: "short",
    day: "numeric",
  });
}

export default function ActiveBatchCard({
  batch,
}: {
  batch: BatchData | null;
}) {
  if (!batch) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-text-dim">
          <Sprout className="h-4 w-4" />
          No active batch in this zone
        </div>
      </div>
    );
  }

  const progress =
    batch.day !== null && batch.estCycleDays
      ? Math.min(100, Math.round((batch.day / batch.estCycleDays) * 100))
      : 0;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sprout className="h-4 w-4 text-green" />
          <span className="text-sm font-medium text-text">
            {batch.batchNumber}
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            phaseColors[batch.phase] || "bg-text-dim/20 text-text-dim"
          }`}
        >
          {batch.phase.replace("_", " ")}
        </span>
      </div>

      <p className="mb-3 text-xs text-text-mid">
        {cropLabels[batch.cropType] || batch.cropType}
      </p>

      {/* Progress bar */}
      <div className="mb-1 flex items-center justify-between text-xs text-text-dim">
        <span>
          Day {batch.day ?? "--"} of {batch.estCycleDays ?? "--"}
        </span>
        <span>{progress}%</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-green transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3 w-3 text-text-dim" />
          <div>
            <p className="text-[10px] text-text-dim">Harvest</p>
            <p className="font-mono text-xs text-text">
              {formatDate(batch.estHarvestDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3 w-3 text-text-dim" />
          <div>
            <p className="text-[10px] text-text-dim">Yield</p>
            <p className="font-mono text-xs text-text">
              {batch.estYieldKg?.toFixed(1) ?? "--"} kg
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Heart className="h-3 w-3 text-text-dim" />
          <div>
            <p className="text-[10px] text-text-dim">Health</p>
            <p
              className={`font-mono text-xs ${
                (batch.healthScore ?? 0) >= 80
                  ? "text-green"
                  : (batch.healthScore ?? 0) >= 60
                    ? "text-amber"
                    : "text-red"
              }`}
            >
              {batch.healthScore ?? "--"}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
