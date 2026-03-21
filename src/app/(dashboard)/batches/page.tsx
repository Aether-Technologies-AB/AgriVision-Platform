"use client";

import { useState, useEffect, useCallback } from "react";
import { Layers, Plus } from "lucide-react";
import BatchTable from "@/components/batches/BatchTable";
import BatchForm from "@/components/batches/BatchForm";

type Tab = "active" | "completed" | "all";

interface BatchRow {
  id: string;
  batchNumber: string;
  cropType: string;
  zone: { id: string; name: string };
  phase: string;
  day: number | null;
  estCycleDays: number | null;
  estHarvestDate: string | null;
  estYieldKg: number | null;
  healthScore: number | null;
  actualYieldKg: number | null;
  actualProfit: number | null;
}

export default function BatchesPage() {
  const [tab, setTab] = useState<Tab>("active");
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const fetchBatches = useCallback(() => {
    setLoading(true);
    fetch(`/api/batches?status=${tab}`)
      .then((r) => r.json())
      .then((d) => {
        setBatches(d.batches || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "completed", label: "Completed" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="h-6 w-6 text-green" />
          <h1 className="text-2xl font-semibold text-text">Batches</h1>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-green px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-green-bright"
        >
          <Plus className="h-4 w-4" />
          New Batch
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-bg-card p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-green/15 text-green"
                : "text-text-mid hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-xl border border-border bg-bg-card p-12 text-center text-sm text-text-dim">
          Loading batches...
        </div>
      ) : (
        <BatchTable batches={batches} />
      )}

      {/* New batch modal */}
      <BatchForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={fetchBatches}
      />
    </div>
  );
}
