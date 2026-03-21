"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";

interface BatchRow {
  id: string;
  batchNumber: string;
  cropType: string;
  zone: { id: string; name: string };
  phase: string;
  day: number | null;
  estCycleDays: number | null;
  estHarvestDate: string | null;
  estYieldKg: number | null;
  healthScore: number | null;
  actualYieldKg: number | null;
  actualProfit: number | null;
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

type SortKey = "batchNumber" | "cropType" | "phase" | "day" | "estHarvestDate" | "healthScore" | "estYieldKg" | "actualProfit";

export default function BatchTable({ batches }: { batches: BatchRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("batchNumber");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...batches].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
    return ((av as number) - (bv as number)) * dir;
  });

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    return (
      <button
        onClick={() => toggleSort(field)}
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-text-dim hover:text-text-mid"
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === field ? "text-green" : ""}`} />
      </button>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-12 text-center text-sm text-text-dim">
        No batches found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left"><SortHeader label="Batch" field="batchNumber" /></th>
            <th className="px-4 py-3 text-left"><SortHeader label="Crop" field="cropType" /></th>
            <th className="px-4 py-3 text-left"><span className="text-xs font-medium uppercase tracking-wider text-text-dim">Zone</span></th>
            <th className="px-4 py-3 text-left"><SortHeader label="Phase" field="phase" /></th>
            <th className="px-4 py-3 text-left"><SortHeader label="Day" field="day" /></th>
            <th className="px-4 py-3 text-left"><SortHeader label="Harvest" field="estHarvestDate" /></th>
            <th className="px-4 py-3 text-left"><SortHeader label="Health" field="healthScore" /></th>
            <th className="px-4 py-3 text-left"><SortHeader label="Yield" field="estYieldKg" /></th>
            <th className="px-4 py-3 text-left"><SortHeader label="Profit" field="actualProfit" /></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((b) => (
            <tr key={b.id} className="border-b border-border/50 transition-colors hover:bg-green/5">
              <td className="px-4 py-3">
                <Link href={`/batches/${b.id}`} className="font-mono text-sm font-medium text-green hover:text-green-bright">
                  {b.batchNumber}
                </Link>
              </td>
              <td className="px-4 py-3 text-text-mid">
                {cropLabels[b.cropType] || b.cropType}
              </td>
              <td className="px-4 py-3 text-text-mid">{b.zone.name}</td>
              <td className="px-4 py-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${phaseColors[b.phase] || ""}`}>
                  {b.phase.replace(/_/g, " ")}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-text-mid">
                {b.day !== null ? `${b.day}/${b.estCycleDays ?? "?"}` : "--"}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-text-mid">
                {b.estHarvestDate
                  ? new Date(b.estHarvestDate).toLocaleDateString("sv-SE", { month: "short", day: "numeric" })
                  : "--"}
              </td>
              <td className="px-4 py-3">
                {b.healthScore !== null ? (
                  <span className={`font-mono ${b.healthScore >= 80 ? "text-green" : b.healthScore >= 60 ? "text-amber" : "text-red"}`}>
                    {b.healthScore}%
                  </span>
                ) : (
                  <span className="text-text-dim">--</span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-text-mid">
                {(b.actualYieldKg ?? b.estYieldKg)?.toFixed(1) ?? "--"} kg
              </td>
              <td className="px-4 py-3 font-mono">
                {b.actualProfit !== null ? (
                  <span className={b.actualProfit >= 0 ? "text-green" : "text-red"}>
                    {b.actualProfit.toFixed(0)} kr
                  </span>
                ) : (
                  <span className="text-text-dim">&mdash;</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
