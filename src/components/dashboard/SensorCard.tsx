"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface SensorCardProps {
  label: string;
  value: number | null;
  prevValue: number | null;
  unit: string;
  icon: React.ReactNode;
  decimals?: number;
  goodRange?: [number, number];
  warnRange?: [number, number];
}

function getStatusColor(
  value: number | null,
  goodRange?: [number, number],
  warnRange?: [number, number]
): string {
  if (value === null) return "text-text-dim";
  if (goodRange && value >= goodRange[0] && value <= goodRange[1])
    return "text-green";
  if (warnRange && value >= warnRange[0] && value <= warnRange[1])
    return "text-amber";
  if (goodRange) return "text-red";
  return "text-green";
}

function AnimatedValue({
  value,
  decimals,
}: {
  value: number | null;
  decimals: number;
}) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value === null || prevRef.current === null) {
      setDisplay(value);
      prevRef.current = value;
      return;
    }
    const start = prevRef.current;
    const end = value;
    const duration = 400;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
    prevRef.current = value;
  }, [value]);

  if (display === null) return <span className="text-text-dim">--</span>;
  return <>{display.toFixed(decimals)}</>;
}

export default function SensorCard({
  label,
  value,
  prevValue,
  unit,
  icon,
  decimals = 1,
  goodRange,
  warnRange,
}: SensorCardProps) {
  const statusColor = getStatusColor(value, goodRange, warnRange);
  const trend =
    value !== null && prevValue !== null ? value - prevValue : null;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-text-mid">
          {label}
        </span>
        <span className="text-text-dim">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono text-3xl font-semibold ${statusColor}`}>
          <AnimatedValue value={value} decimals={decimals} />
        </span>
        <span className="text-sm text-text-mid">{unit}</span>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs">
        {trend !== null ? (
          <>
            {Math.abs(trend) < 0.05 ? (
              <Minus className="h-3 w-3 text-text-dim" />
            ) : trend > 0 ? (
              <TrendingUp className="h-3 w-3 text-amber" />
            ) : (
              <TrendingDown className="h-3 w-3 text-blue" />
            )}
            <span className="text-text-dim">
              {trend > 0 ? "+" : ""}
              {trend.toFixed(decimals)} vs 1h ago
            </span>
          </>
        ) : (
          <span className="text-text-dim">No trend data</span>
        )}
      </div>
    </div>
  );
}
