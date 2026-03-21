"use client";

import Link from "next/link";
import {
  TrendingUp,
  CalendarCheck,
  Eye,
  Truck,
  Wrench,
  CheckCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";

interface ScheduleEvent {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  status: string;
  batch: { id: string; batchNumber: string; cropType: string } | null;
}

const typeIcons: Record<string, React.ReactNode> = {
  HARVEST_WINDOW: <TrendingUp className="h-3.5 w-3.5 text-green" />,
  INOCULATION: <CalendarCheck className="h-3.5 w-3.5 text-blue" />,
  PHASE_CHANGE: <CalendarCheck className="h-3.5 w-3.5 text-blue" />,
  VISION_CHECK: <Eye className="h-3.5 w-3.5 text-purple" />,
  DELIVERY: <Truck className="h-3.5 w-3.5 text-amber" />,
  MAINTENANCE: <Wrench className="h-3.5 w-3.5 text-text-mid" />,
  CUSTOM: <CalendarCheck className="h-3.5 w-3.5 text-text-mid" />,
};

function getDisplayStatus(event: ScheduleEvent): { label: string; style: string; icon: React.ReactNode } {
  if (event.status === "COMPLETED") {
    return { label: "Done", style: "bg-green/15 text-green", icon: <CheckCircle className="h-3 w-3" /> };
  }
  if (event.status === "SKIPPED") {
    return { label: "Skipped", style: "bg-text-dim/20 text-text-dim", icon: null };
  }
  // Check if overdue
  if (event.status === "PENDING" && new Date(event.scheduledAt) < new Date()) {
    return { label: "Overdue", style: "bg-red/15 text-red", icon: <AlertTriangle className="h-3 w-3" /> };
  }
  return { label: "Pending", style: "bg-amber/15 text-amber", icon: <Clock className="h-3 w-3" /> };
}

export default function EventList({
  events,
  onMarkComplete,
}: {
  events: ScheduleEvent[];
  onMarkComplete: (id: string) => void;
}) {
  // Filter to next 14 days
  const now = new Date();
  const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const upcoming = events
    .filter((e) => {
      const d = new Date(e.scheduledAt);
      return d <= twoWeeks || e.status === "PENDING";
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 15);

  if (upcoming.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-4 text-center text-sm text-text-dim">
        No upcoming events
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-text">Upcoming Events</h3>
      <div className="space-y-2">
        {upcoming.map((e) => {
          const st = getDisplayStatus(e);
          const d = new Date(e.scheduledAt);

          return (
            <div
              key={e.id}
              className="rounded-lg border border-border/50 p-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5">
                    {typeIcons[e.eventType] || <CalendarCheck className="h-3.5 w-3.5 text-text-dim" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text">{e.title}</p>
                    <p className="text-[10px] text-text-dim">
                      {d.toLocaleDateString("sv-SE", { month: "short", day: "numeric" })}
                      {" "}
                      {d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    {e.batch && (
                      <Link
                        href={`/batches/${e.batch.id}`}
                        className="text-[10px] text-green hover:text-green-bright"
                      >
                        {e.batch.batchNumber}
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.style}`}>
                    {st.icon}
                    {st.label}
                  </span>
                  {e.status === "PENDING" && (
                    <button
                      onClick={() => onMarkComplete(e.id)}
                      className="rounded p-0.5 text-text-dim hover:text-green"
                      title="Mark complete"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
