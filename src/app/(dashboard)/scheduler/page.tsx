"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import CalendarGrid from "@/components/scheduler/CalendarGrid";
import EventList from "@/components/scheduler/EventList";
import SmartScheduler from "@/components/scheduler/SmartScheduler";
import QuickActionForms from "@/components/scheduler/QuickActionForms";

interface ScheduleEvent {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  status: string;
  batch: { id: string; batchNumber: string; cropType: string } | null;
}

interface Plan {
  plantDate: string;
  zone: string;
  bagCount: number;
  estHarvestDate: string;
  bufferDays: number;
  confidence: number;
  reasoning: string;
}

export default function SchedulerPage() {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<{ date: string; events: ScheduleEvent[] } | null>(null);

  const fetchEvents = useCallback(() => {
    // Fetch 3 months range
    const from = new Date();
    from.setMonth(from.getMonth() - 1);
    const to = new Date();
    to.setMonth(to.getMonth() + 3);

    fetch(`/api/schedule?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((r) => r.json())
      .then((d) => {
        setEvents(d.events || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  async function markComplete(id: string) {
    await fetch(`/api/schedule/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    fetchEvents();
  }

  function handleCreateBatch(plan: Plan) {
    // Navigate to batches page with prefilled data via query params
    const params = new URLSearchParams({
      cropType: plan.zone, // This will open the batch form
      bagCount: String(plan.bagCount),
      plantedAt: plan.plantDate,
    });
    window.location.href = `/batches?newBatch=1&${params.toString()}`;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <CalendarIcon className="h-6 w-6 text-green" />
        <h1 className="text-2xl font-semibold text-text">Scheduler</h1>
      </div>

      {/* Smart Scheduler */}
      <SmartScheduler onCreateBatch={handleCreateBatch} />

      {/* Main layout */}
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Left: Calendar */}
        <div className="lg:col-span-3">
          {loading ? (
            <div className="rounded-xl border border-border bg-bg-card p-12 text-center text-sm text-text-dim">
              Loading calendar...
            </div>
          ) : (
            <CalendarGrid
              events={events}
              onDateClick={(date, dayEvents) =>
                setSelectedDate({ date, events: dayEvents })
              }
            />
          )}

          {/* Day detail popover */}
          {selectedDate && (
            <div className="mt-3 rounded-xl border border-border bg-bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-text">
                  {new Date(selectedDate.date + "T00:00:00").toLocaleDateString("sv-SE", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </h3>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="text-xs text-text-dim hover:text-text-mid"
                >
                  Close
                </button>
              </div>
              <div className="space-y-2">
                {selectedDate.events.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-lg border border-border/50 p-2.5"
                  >
                    <p className="text-xs font-medium text-text">{e.title}</p>
                    {e.description && (
                      <p className="mt-0.5 text-[10px] text-text-mid">{e.description}</p>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] text-text-dim">
                        {new Date(e.scheduledAt).toLocaleTimeString("sv-SE", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          e.status === "COMPLETED"
                            ? "bg-green/15 text-green"
                            : e.status === "PENDING"
                              ? "bg-amber/15 text-amber"
                              : "bg-text-dim/20 text-text-dim"
                        }`}
                      >
                        {e.status}
                      </span>
                      {e.batch && (
                        <span className="text-[10px] text-green">
                          {e.batch.batchNumber}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Event list + Quick actions */}
        <div className="space-y-4 lg:col-span-2">
          <EventList events={events} onMarkComplete={markComplete} />
          <QuickActionForms onCreated={fetchEvents} />
        </div>
      </div>
    </div>
  );
}
