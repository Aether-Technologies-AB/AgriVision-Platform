"use client";

import { useState } from "react";
import { ArrowUpDown, Trophy } from "lucide-react";

interface BatchData {
  batchNumber: string;
  crop: string;
  zone: string;
  yieldKg: number | null;
  revenue: number | null;
  totalCost: number | null;
  profit: number | null;
  costPerGram: number | null;
  qualityGrade: string | null;
  daysToHarvest: number | null;
}

const cropLabels: Record<string, string> = {
  oyster_blue: "Blue Oyster",
  oyster_pink: "Pink Oyster",
  oyster_yellow: "Yellow Oyster",
  lions_mane: "Lion's Mane",
  shiitake: "Shiitake",
};

type SortKey = "batchNumber" | "yieldKg" | "revenue" | "totalCost" | "profit" | "costPerGram" | "daysToHarvest";

export default function BatchComparison({ data }: { data: BatchData[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-text-dim">
        No completed batches to compare yet.
      </div>
    );
  }

  // Find best batch (highest profit)
  const bestBatch = data.reduce((best, b) =>
    (b.profit ?? -Infinity) > (best.profit ?? -Infinity) ? b : best
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...data].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string") return av.localeCompare(bv as string) * dir;
    return ((av as number) - (bv as number)) * dir;
  });

  function SH({ label, field }: { label: string; field: SortKey }) {
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

  return (
    <div className="rounded-xl border border-border bg-bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-text">Batch Comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left"><SH label="Batch" field="batchNumber" /></th>
              <th className="px-4 py-3 text-left"><span className="text-xs font-medium uppercase tracking-wider text-text-dim">Crop</span></th>
              <th className="px-4 py-3 text-left"><span className="text-xs font-medium uppercase tracking-wider text-text-dim">Zone</span></th>
              <th className="px-4 py-3 text-left"><SH label="Yield" field="yieldKg" /></th>
              <th className="px-4 py-3 text-left"><SH label="Revenue" field="revenue" /></th>
              <th className="px-4 py-3 text-left"><SH label="Cost" field="totalCost" /></th>
              <th className="px-4 py-3 text-left"><SH label="Profit" field="profit" /></th>
              <th className="px-4 py-3 text-left"><SH label="Cost/g" field="costPerGram" /></th>
              <th className="px-4 py-3 text-left"><SH label="Cycle" field="daysToHarvest" /></th>
              <th className="px-4 py-3 text-left"><span className="text-xs font-medium uppercase tracking-wider text-text-dim">Grade</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => {
              const isBest = b.batchNumber === bestBatch.batchNumber;
              return (
                <tr
                  key={b.batchNumber}
                  className={`border-b border-border/50 ${isBest ? "bg-green/5" : "hover:bg-green/3"}`}
                >
                  <td className="px-4 py-3 font-mono text-sm font-medium text-text">
                    <span className="flex items-center gap-1.5">
                      {isBest && <Trophy className="h-3 w-3 text-amber" />}
                      {b.batchNumber}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-mid">{cropLabels[b.crop] || b.crop}</td>
                  <td className="px-4 py-3 text-text-mid">{b.zone}</td>
                  <td className="px-4 py-3 font-mono text-text-mid">{b.yieldKg?.toFixed(1) ?? "--"} kg</td>
                  <td className="px-4 py-3 font-mono text-text-mid">{b.revenue?.toFixed(0) ?? "--"} kr</td>
                  <td className="px-4 py-3 font-mono text-text-mid">{b.totalCost?.toFixed(0) ?? "--"} kr</td>
                  <td className="px-4 py-3 font-mono">
                    <span className={(b.profit ?? 0) >= 0 ? "text-green" : "text-red"}>
                      {b.profit?.toFixed(0) ?? "--"} kr
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-mid">{b.costPerGram?.toFixed(3) ?? "--"}</td>
                  <td className="px-4 py-3 font-mono text-text-mid">{b.daysToHarvest ?? "--"}</td>
                  <td className="px-4 py-3">
                    {b.qualityGrade ? (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        b.qualityGrade === "A" ? "bg-green/15 text-green" :
                        b.qualityGrade === "B" ? "bg-amber/15 text-amber" :
                        "bg-red/15 text-red"
                      }`}>
                        {b.qualityGrade}
                      </span>
                    ) : "--"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
