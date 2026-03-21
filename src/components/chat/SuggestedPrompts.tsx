"use client";

import { Brain, TrendingUp, Calendar, BarChart3 } from "lucide-react";

const suggestions = [
  {
    icon: <TrendingUp className="h-4 w-4 text-green" />,
    text: "Should I harvest B-2026-007 now or wait?",
  },
  {
    icon: <Calendar className="h-4 w-4 text-amber" />,
    text: "Schedule 5 kg oyster delivery for April 20",
  },
  {
    icon: <Brain className="h-4 w-4 text-purple" />,
    text: "Why is Zone B underperforming?",
  },
  {
    icon: <BarChart3 className="h-4 w-4 text-blue" />,
    text: "Compare this month vs last month",
  },
];

export default function SuggestedPrompts({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-purple/10">
          <Brain className="h-7 w-7 text-purple" />
        </div>
        <h2 className="text-lg font-semibold text-text">
          AgriVision AI Assistant
        </h2>
        <p className="mt-1 text-sm text-text-mid">
          Ask anything about your farm — harvests, schedules, performance, or
          troubleshooting.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.text}
            onClick={() => onSelect(s.text)}
            className="flex items-start gap-3 rounded-xl border border-border bg-bg-card p-3.5 text-left transition-colors hover:border-green/30 hover:bg-green/5"
          >
            <span className="mt-0.5 shrink-0">{s.icon}</span>
            <span className="text-sm text-text-mid">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
