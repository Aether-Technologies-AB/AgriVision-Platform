"use client";

import { useState, useEffect } from "react";
import { Eye, TrendingUp, CalendarPlus, Loader2, Check } from "lucide-react";

interface Zone {
  id: string;
  name: string;
  farm: { name: string };
}

interface Batch {
  id: string;
  batchNumber: string;
  cropType: string;
  phase: string;
}

type ActionType = "vision" | "harvest" | "custom" | null;

export default function QuickActionForms({ onCreated }: { onCreated: () => void }) {
  const [activeForm, setActiveForm] = useState<ActionType>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Form fields
  const [zoneId, setZoneId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (activeForm) {
      Promise.all([
        fetch("/api/zones").then((r) => r.json()),
        fetch("/api/batches?status=active").then((r) => r.json()),
      ]).then(([z, b]) => {
        setZones(z.zones || []);
        setBatches(b.batches || []);
        if (z.zones?.length > 0) setZoneId(z.zones[0].id);
        if (b.batches?.length > 0) setBatchId(b.batches[0].id);
      });
    }
  }, [activeForm]);

  async function submit(eventType: string, eventTitle: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: batchId || null,
          eventType,
          title: eventTitle,
          description: description || null,
          scheduledAt,
        }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          setActiveForm(null);
          setTitle("");
          setDescription("");
          setScheduledAt("");
          onCreated();
        }, 1000);
      }
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-green/20 bg-green/5 p-4 text-center">
        <Check className="mx-auto mb-1 h-5 w-5 text-green" />
        <p className="text-sm text-green">Event scheduled!</p>
      </div>
    );
  }

  if (!activeForm) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-text">Quick Actions</h3>
        <div className="space-y-2">
          <button
            onClick={() => setActiveForm("vision")}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs text-text-mid transition-colors hover:bg-purple/5 hover:text-purple"
          >
            <Eye className="h-3.5 w-3.5" />
            Schedule Vision Check
          </button>
          <button
            onClick={() => setActiveForm("harvest")}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs text-text-mid transition-colors hover:bg-green/5 hover:text-green"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Schedule Harvest
          </button>
          <button
            onClick={() => setActiveForm("custom")}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs text-text-mid transition-colors hover:bg-amber/5 hover:text-amber"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Add Custom Event
          </button>
        </div>
      </div>
    );
  }

  const formConfig: Record<string, { eventType: string; titlePrefix: string; color: string }> = {
    vision: { eventType: "VISION_CHECK", titlePrefix: "Vision Check", color: "purple" },
    harvest: { eventType: "HARVEST_WINDOW", titlePrefix: "Harvest", color: "green" },
    custom: { eventType: "CUSTOM", titlePrefix: "", color: "amber" },
  };

  const cfg = formConfig[activeForm];

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">
          {activeForm === "vision" && "Schedule Vision Check"}
          {activeForm === "harvest" && "Schedule Harvest"}
          {activeForm === "custom" && "Add Custom Event"}
        </h3>
        <button onClick={() => setActiveForm(null)} className="text-xs text-text-dim hover:text-text-mid">
          Cancel
        </button>
      </div>

      <div className="space-y-2.5">
        {activeForm === "custom" && (
          <div>
            <label className="mb-0.5 block text-[10px] text-text-dim">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-green focus:outline-none"
            />
          </div>
        )}

        {(activeForm === "vision" || activeForm === "harvest") && batches.length > 0 && (
          <div>
            <label className="mb-0.5 block text-[10px] text-text-dim">Batch</label>
            <select
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber} ({b.cropType})
                </option>
              ))}
            </select>
          </div>
        )}

        {activeForm === "vision" && zones.length > 0 && (
          <div>
            <label className="mb-0.5 block text-[10px] text-text-dim">Zone</label>
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-0.5 block text-[10px] text-text-dim">Date & Time</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
          />
        </div>

        {activeForm === "custom" && (
          <div>
            <label className="mb-0.5 block text-[10px] text-text-dim">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-green focus:outline-none"
            />
          </div>
        )}

        <button
          onClick={() => {
            const t = activeForm === "custom"
              ? title
              : `${cfg.titlePrefix} — ${batches.find((b) => b.id === batchId)?.batchNumber || ""}`;
            if (!scheduledAt || (!t && activeForm === "custom")) return;
            submit(cfg.eventType, t);
          }}
          disabled={loading || !scheduledAt}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg bg-${cfg.color} px-3 py-1.5 text-xs font-semibold text-white hover:opacity-80 disabled:opacity-50`}
          style={{ backgroundColor: cfg.color === "purple" ? "#a78bfa" : cfg.color === "green" ? "#4abe7b" : "#e8a830" }}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarPlus className="h-3 w-3" />}
          Schedule
        </button>
      </div>
    </div>
  );
}
