"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Camera,
  CalendarCheck,
  Droplets,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  Eye,
  Calendar,
  ChevronDown,
} from "lucide-react";

interface TimelineEvent {
  id: string;
  type: "decision" | "photo" | "event";
  subtype: string;
  title: string;
  detail: string | null;
  timestamp: string;
  meta?: Record<string, unknown>;
}

const typeIcons: Record<string, React.ReactNode> = {
  ENVIRONMENT: <Droplets className="h-4 w-4 text-blue" />,
  VISION: <Eye className="h-4 w-4 text-purple" />,
  HARVEST: <TrendingUp className="h-4 w-4 text-amber" />,
  SCHEDULE: <Calendar className="h-4 w-4 text-green" />,
  ALERT: <AlertTriangle className="h-4 w-4 text-red" />,
  STRATEGIC: <BarChart3 className="h-4 w-4 text-green" />,
  CAPTURE: <Camera className="h-4 w-4 text-purple" />,
  INOCULATION: <CalendarCheck className="h-4 w-4 text-blue" />,
  PHASE_CHANGE: <CalendarCheck className="h-4 w-4 text-green" />,
  VISION_CHECK: <Eye className="h-4 w-4 text-purple" />,
  HARVEST_WINDOW: <TrendingUp className="h-4 w-4 text-amber" />,
  DELIVERY: <CalendarCheck className="h-4 w-4 text-green" />,
  MAINTENANCE: <CalendarCheck className="h-4 w-4 text-text-mid" />,
  CUSTOM: <CalendarCheck className="h-4 w-4 text-text-mid" />,
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) + " today";
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("sv-SE", { month: "short", day: "numeric" });
}

function TimelineItem({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const icon = typeIcons[event.subtype] || <Brain className="h-4 w-4 text-text-dim" />;

  const typeBadge: Record<string, string> = {
    decision: "AI",
    photo: "Photo",
    event: "Event",
  };

  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {/* Connector line */}
      <div className="absolute left-[15px] top-8 -bottom-0 w-px bg-border last:hidden" />
      {/* Icon */}
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-card">
        {icon}
      </div>
      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-2">
          <span className="rounded bg-border/60 px-1.5 py-0.5 text-[10px] font-medium uppercase text-text-dim">
            {typeBadge[event.type]}
          </span>
          <span className="text-xs font-medium text-text">{event.title}</span>
          <span className="ml-auto text-[10px] text-text-dim">
            {formatTimestamp(event.timestamp)}
          </span>
        </div>
        {event.detail && (
          <p
            className={`mt-1 text-xs text-text-mid ${expanded ? "" : "line-clamp-2"}`}
            onClick={() => setExpanded(!expanded)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setExpanded(!expanded)}
          >
            {event.detail}
          </p>
        )}
        {expanded && event.meta?.actionTaken ? (
          <p className="mt-1 text-xs text-green-dim">
            Action: {String(event.meta.actionTaken)}
          </p>
        ) : null}
        {event.meta?.costKr ? (
          <span className="mt-1 inline-block text-[10px] text-text-dim">
            AI cost: {Number(event.meta.costKr).toFixed(2)} kr
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function BatchTimeline({ batchId }: { batchId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchEvents = useCallback(async (cursor?: string) => {
    const url = `/api/batches/${batchId}/timeline${cursor ? `?cursor=${cursor}` : ""}`;
    const res = await fetch(url);
    const data = await res.json();
    return data;
  }, [batchId]);

  useEffect(() => {
    setLoading(true);
    fetchEvents().then((data) => {
      setEvents(data.events || []);
      setNextCursor(data.nextCursor);
      setLoading(false);
    });
  }, [fetchEvents]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const data = await fetchEvents(nextCursor);
    setEvents((prev) => [...prev, ...(data.events || [])]);
    setNextCursor(data.nextCursor);
    setLoadingMore(false);
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-text-dim">
        Loading timeline...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-text-dim">
        No events recorded yet
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      <h3 className="mb-4 text-sm font-medium text-text">Timeline</h3>
      <div className="space-y-0">
        {events.map((e) => (
          <TimelineItem key={`${e.type}-${e.id}`} event={e} />
        ))}
      </div>
      {nextCursor && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-4 flex w-full items-center justify-center gap-1 rounded-lg border border-border py-2 text-xs text-text-dim hover:bg-green/5 hover:text-text-mid disabled:opacity-50"
        >
          <ChevronDown className="h-3 w-3" />
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
