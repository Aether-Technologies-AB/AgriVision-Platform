"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CalendarEvent {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  status: string;
  batch: { id: string; batchNumber: string; cropType: string } | null;
}

const typeColors: Record<string, string> = {
  HARVEST_WINDOW: "bg-green",
  INOCULATION: "bg-blue",
  PHASE_CHANGE: "bg-blue",
  VISION_CHECK: "bg-purple",
  DELIVERY: "bg-amber",
  MAINTENANCE: "bg-text-dim",
  CUSTOM: "bg-text-dim",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Monday=0 adjustment (JS getDay(): 0=Sun)
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const days: { date: Date; inMonth: boolean }[] = [];

  // Previous month padding
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d, inMonth: false });
  }

  // Current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: new Date(year, month, d), inMonth: true });
  }

  // Next month padding
  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({ date: new Date(year, month + 1, d), inMonth: false });
  }

  return days;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarGrid({
  events,
  onDateClick,
}: {
  events: CalendarEvent[];
  onDateClick: (date: string, dayEvents: CalendarEvent[]) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const days = getMonthDays(year, month);

  // Group events by date
  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = dateKey(new Date(e.scheduledAt));
    if (!eventsByDate.has(key)) eventsByDate.set(key, []);
    eventsByDate.get(key)!.push(e);
  }

  function prevMonth() {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  }

  const todayKey = dateKey(today);

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={prevMonth} className="rounded-lg p-1.5 text-text-dim hover:bg-green/5 hover:text-text">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h3 className="text-sm font-semibold text-text">
          {MONTHS[month]} {year}
        </h3>
        <button onClick={nextMonth} className="rounded-lg p-1.5 text-text-dim hover:bg-green/5 hover:text-text">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="mb-1 grid grid-cols-7 gap-px">
        {DAYS.map((d) => (
          <div key={d} className="py-1 text-center text-[10px] font-medium uppercase tracking-wider text-text-dim">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-px">
        {days.map(({ date, inMonth }, i) => {
          const key = dateKey(date);
          const isToday = key === todayKey;
          const dayEvents = eventsByDate.get(key) || [];
          const hasEvents = dayEvents.length > 0;

          return (
            <button
              key={i}
              onClick={() => hasEvents && onDateClick(key, dayEvents)}
              className={`relative flex min-h-[4rem] flex-col items-start rounded-lg p-1.5 text-left transition-colors ${
                !inMonth
                  ? "text-text-dim/30"
                  : isToday
                    ? "bg-green/10 text-green"
                    : "text-text-mid hover:bg-green/5"
              } ${hasEvents ? "cursor-pointer" : "cursor-default"}`}
            >
              <span className={`text-xs font-medium ${isToday ? "rounded-full bg-green px-1.5 text-bg" : ""}`}>
                {date.getDate()}
              </span>
              {/* Event dots */}
              {inMonth && dayEvents.length > 0 && (
                <div className="mt-auto flex flex-wrap gap-0.5 pt-1">
                  {dayEvents.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      className={`h-1.5 w-1.5 rounded-full ${typeColors[e.eventType] || "bg-text-dim"} ${
                        e.status === "COMPLETED" ? "opacity-40" : ""
                      }`}
                      title={e.title}
                    />
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[8px] text-text-dim">+{dayEvents.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        {[
          { label: "Harvest", color: "bg-green" },
          { label: "Phase/Inoculation", color: "bg-blue" },
          { label: "Vision", color: "bg-purple" },
          { label: "Delivery", color: "bg-amber" },
          { label: "Other", color: "bg-text-dim" },
        ].map((l) => (
          <span key={l.label} className="flex items-center gap-1 text-[10px] text-text-dim">
            <span className={`h-2 w-2 rounded-full ${l.color}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
