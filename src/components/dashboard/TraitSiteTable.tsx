"use client";

import { ArrowUp, ArrowDown, Minus } from "lucide-react";

export interface SitePoint {
  day: string;
  volumeCm3: number | null;
  heightCm: number | null;
  heightMaxCm: number | null;
  coveragePct: number | null;
  plantPresent: boolean;
}

export interface SiteSummary {
  siteId: string;
  latest: SitePoint | null;
  trend: "up" | "down" | "flat" | null;
  series: SitePoint[];
}

function fmt(v: number | null, digits = 0): string {
  return v === null || v === undefined ? "--" : v.toFixed(digits);
}

function TrendIcon({ trend }: { trend: SiteSummary["trend"] }) {
  if (trend === "up") return <ArrowUp className="h-3.5 w-3.5 text-green" />;
  if (trend === "down") return <ArrowDown className="h-3.5 w-3.5 text-red" />;
  if (trend === "flat") return <Minus className="h-3.5 w-3.5 text-text-dim" />;
  return <span className="text-text-dim">--</span>;
}

export default function TraitSiteTable({ sites }: { sites: SiteSummary[] }) {
  if (sites.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-text">
        Per-site traits
        <span className="ml-2 text-xs font-normal text-text-dim">
          latest measured values
        </span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-text-dim">
              <th className="pb-2 pr-3 font-medium">Site</th>
              <th className="pb-2 pr-3 text-right font-medium">Volume (cm³)</th>
              <th className="pb-2 pr-3 text-right font-medium">Height (cm)</th>
              <th className="pb-2 pr-3 text-right font-medium">Coverage (%)</th>
              <th className="pb-2 pr-3 text-center font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => {
              const l = s.latest;
              const absent = l !== null && !l.plantPresent;
              return (
                <tr
                  key={s.siteId}
                  className="border-t border-border/60 text-text"
                >
                  <td className="py-1.5 pr-3 font-mono">
                    {s.siteId}
                    {absent && (
                      <span className="ml-1.5 text-[10px] text-text-dim">
                        (no plant)
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono">
                    {fmt(l?.volumeCm3 ?? null, 0)}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono">
                    {fmt(l?.heightCm ?? null, 1)}
                    {l?.heightMaxCm != null && (
                      <span className="ml-1 text-[10px] text-text-dim">
                        max {fmt(l.heightMaxCm, 1)}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono">
                    {fmt(l?.coveragePct ?? null, 0)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <div className="flex justify-center">
                      <TrendIcon trend={s.trend} />
                    </div>
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
