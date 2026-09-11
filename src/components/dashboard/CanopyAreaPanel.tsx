"use client";

import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { AreaPoint } from "@/lib/area-measurement";

export type CanopyAreaData = {
  method: string;
  days: { day: string; medianCm2: number | null; includedSites: number; reviewSites: number }[];
  sites: AreaPoint[];
};

const WARNINGS: Record<string, string> = {
  near_frame_edge: "Near photo edge",
  low_depth_support: "Weak depth support",
  insufficient_depth: "Insufficient depth",
  ambiguous_match: "Ambiguous plant assignment",
  missing_provenance: "Missing measurement provenance",
};

export default function CanopyAreaPanel({ data, method, onMethodChange }: {
  data: CanopyAreaData; method: string; onMethodChange: (method: string) => void;
}) {
  return <section className="rounded-xl border border-border bg-bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium text-text">Estimated canopy area · cm²</h3>
      <label className="text-xs text-text-mid">Area method{" "}
        <select aria-label="Area measurement method" value={method} onChange={e => onMethodChange(e.target.value)}
          className="rounded border border-border bg-bg-card p-1 text-text">
          <option value="seg-area-v2">Canopy area v2</option>
          <option value="seg-v1">Previous segmentation filters</option>
          <option value="gate">Original ROI method</option>
        </select>
      </label>
    </div>
    <p className="mt-2 text-xs text-text-dim">
      Visible projected canopy, one primary view per plant. Daily median excludes rejected plants,
      weak depth and ambiguous assignments. Edge estimates remain included. Height and volume use the original method.
    </p>
    {data.days.length === 0 ? <p className="py-6 text-sm text-text-dim">No measurements for this method in the selected range.</p> : <>
      <div className="mt-3 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.days.map(d => ({ ...d, date: d.day.slice(0,10) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2e25" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis unit=" cm²" tick={{ fontSize: 10 }} width={70} />
            <Tooltip />
            <Line dataKey="medianCm2" name="Median area (cm²)" stroke="#4abe7b" dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs" open>
        <summary className="cursor-pointer text-text-mid">Latest measurement per plant ({data.sites.length}) · {data.method}</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full text-left">
            <thead><tr className="text-text-dim"><th className="p-2">Plant</th><th>Captured (UTC)</th><th>Area cm²</th><th>Quality</th></tr></thead>
            <tbody>{data.sites.map(s => <tr key={s.siteId} className="border-t border-border text-text-mid">
              <td className="p-2">{s.siteId}</td><td>{s.capturedAt.slice(0,16).replace("T", " ")}</td>
              <td className="font-mono">{s.areaCm2?.toFixed(1) ?? "—"}</td>
              <td>{[...(!s.plantPresent ? ["Presence rejected"] : []), ...s.qualityFlags.map(f => WARNINGS[f] ?? f), ...(!s.eligible ? ["Review only"] : [])].join(" · ") || "Depth supported"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </>}
  </section>;
}
