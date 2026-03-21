"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronUp } from "lucide-react";

interface Decision {
  id: string;
  decisionType: string;
  decision: string;
  reasoning: string;
  actionTaken: string | null;
  costKr: number | null;
  timestamp: string;
}

const typeIcons: Record<string, string> = {
  ENVIRONMENT: "\u{1F4A7}",
  VISION: "\u{1F4F7}",
  HARVEST: "\u{1F4B0}",
  SCHEDULE: "\u{1F4C5}",
  ALERT: "\u{26A0}\u{FE0F}",
  STRATEGIC: "\u{1F4CA}",
};

const typeColors: Record<string, string> = {
  ENVIRONMENT: "text-blue",
  VISION: "text-purple",
  HARVEST: "text-amber",
  SCHEDULE: "text-green",
  ALERT: "text-red",
  STRATEGIC: "text-green",
};

function formatAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function DecisionItem({ decision: d }: { decision: Decision }) {
  const [expanded, setExpanded] = useState(false);
  const icon = typeIcons[d.decisionType] || "\u{1F916}";

  return (
    <div className="border-b border-border/50 py-3 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="mt-0.5 text-sm">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium ${
                typeColors[d.decisionType] || "text-text-mid"
              }`}
            >
              {d.decision}
            </span>
            <span className="text-[10px] text-text-dim">
              {formatAgo(d.timestamp)}
            </span>
          </div>
          <p
            className={`mt-0.5 text-xs text-text-mid ${
              expanded ? "" : "line-clamp-2"
            }`}
          >
            {d.reasoning}
          </p>
          {d.actionTaken && expanded && (
            <p className="mt-1 text-xs text-green-dim">
              Action: {d.actionTaken}
            </p>
          )}
        </div>
        {d.reasoning.length > 100 && (
          <span className="mt-1 text-text-dim">
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </span>
        )}
      </button>
    </div>
  );
}

export default function AIDecisionFeed({
  decisions,
}: {
  decisions: Decision[];
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Brain className="h-4 w-4 text-purple" />
        <span className="text-sm font-medium text-text">AI Decisions</span>
        <span className="ml-auto text-xs text-text-dim">
          {decisions.length} recent
        </span>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {decisions.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-dim">
            No decisions yet
          </p>
        ) : (
          decisions.map((d) => <DecisionItem key={d.id} decision={d} />)
        )}
      </div>
    </div>
  );
}
