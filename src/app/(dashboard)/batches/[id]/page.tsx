"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Sprout,
  Calendar,
  TrendingUp,
  Heart,
  Loader2,
  AlertTriangle,
  MessageSquare,
  XCircle,
} from "lucide-react";
import BatchTimeline from "@/components/batches/BatchTimeline";
import PhotoGallery from "@/components/batches/PhotoGallery";
import HarvestForm from "@/components/batches/HarvestForm";

const phaseColors: Record<string, string> = {
  PLANNED: "bg-text-dim/20 text-text-dim",
  COLONIZATION: "bg-blue/15 text-blue",
  FRUITING: "bg-green/15 text-green",
  READY_TO_HARVEST: "bg-amber/15 text-amber",
  HARVESTED: "bg-green-dim/20 text-green-dim",
  CANCELLED: "bg-red/15 text-red",
};

const cropLabels: Record<string, string> = {
  oyster_blue: "Blue Oyster",
  oyster_pink: "Pink Oyster",
  oyster_yellow: "Yellow Oyster",
  lions_mane: "Lion's Mane",
  shiitake: "Shiitake",
};

interface BatchDetail {
  id: string;
  batchNumber: string;
  cropType: string;
  substrate: string;
  bagCount: number;
  phase: string;
  day: number | null;
  estCycleDays: number | null;
  plantedAt: string | null;
  fruitingAt: string | null;
  harvestedAt: string | null;
  estHarvestDate: string | null;
  estYieldKg: number | null;
  estProfit: number | null;
  actualYieldKg: number | null;
  actualRevenue: number | null;
  actualCost: number | null;
  actualProfit: number | null;
  qualityGrade: string | null;
  healthScore: number | null;
  notes: string | null;
  createdAt: string;
  zone: { id: string; name: string };
  farmName: string;
  harvest: {
    weightKg: number;
    qualityGrade: string;
    pricePerKg: number;
    revenue: number;
    totalCost: number;
    profit: number;
    costPerGram: number;
  } | null;
  counts: { decisions: number; events: number; photos: number };
}

export default function BatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const fetchBatch = useCallback(() => {
    setLoading(true);
    fetch(`/api/batches/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setBatch(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

  async function updatePhase(
    newPhase: string,
    extraData?: Record<string, unknown>,
    command?: string
  ) {
    setActionLoading(true);
    try {
      const patchData: Record<string, unknown> = {
        phase: newPhase,
        ...extraData,
      };
      await fetch(`/api/batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchData),
      });

      if (command && batch?.zone.id) {
        await fetch(`/api/commands/${batch.zone.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command }),
        });
      }

      fetchBatch();
    } finally {
      setActionLoading(false);
    }
  }

  async function addNote() {
    if (!noteInput.trim()) return;
    const current = batch?.notes || "";
    const timestamp = new Date().toLocaleDateString("sv-SE");
    const updated = current
      ? `${current}\n[${timestamp}] ${noteInput.trim()}`
      : `[${timestamp}] ${noteInput.trim()}`;

    await fetch(`/api/batches/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: updated }),
    });
    setNoteInput("");
    setShowNoteInput(false);
    fetchBatch();
  }

  async function cancelBatch() {
    await updatePhase("CANCELLED");
    setConfirmCancel(false);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-text-dim">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="text-center text-text-dim">
        <p>Batch not found</p>
        <Link href="/batches" className="mt-2 text-green hover:text-green-bright">
          Back to batches
        </Link>
      </div>
    );
  }

  const progress =
    batch.day !== null && batch.estCycleDays
      ? Math.min(100, Math.round((batch.day / batch.estCycleDays) * 100))
      : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            onClick={() => router.push("/batches")}
            className="mb-2 flex items-center gap-1 text-xs text-text-dim hover:text-text-mid"
          >
            <ArrowLeft className="h-3 w-3" /> Back to batches
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-text">
              {batch.batchNumber}
            </h1>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                phaseColors[batch.phase] || ""
              }`}
            >
              {batch.phase.replace(/_/g, " ")}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-mid">
            {cropLabels[batch.cropType] || batch.cropType} &middot;{" "}
            {batch.zone.name} &middot; {batch.bagCount} bags ({batch.substrate})
            &middot; Created{" "}
            {new Date(batch.createdAt).toLocaleDateString("sv-SE")}
          </p>
        </div>

        {/* Phase actions */}
        <div className="flex gap-2">
          {batch.phase === "PLANNED" && (
            <button
              onClick={() =>
                updatePhase("COLONIZATION", {
                  plantedAt: new Date().toISOString(),
                })
              }
              disabled={actionLoading}
              className="rounded-lg bg-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue/80 disabled:opacity-50"
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Start Colonization"
              )}
            </button>
          )}
          {batch.phase === "COLONIZATION" && (
            <button
              onClick={() =>
                updatePhase(
                  "FRUITING",
                  { fruitingAt: new Date().toISOString() },
                  "START_FRUITING"
                )
              }
              disabled={actionLoading}
              className="rounded-lg bg-green px-4 py-2 text-sm font-semibold text-bg hover:bg-green-bright disabled:opacity-50"
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Start Fruiting"
              )}
            </button>
          )}
          {batch.phase === "FRUITING" && (
            <button
              onClick={() => updatePhase("READY_TO_HARVEST")}
              disabled={actionLoading}
              className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-bg hover:bg-amber/80 disabled:opacity-50"
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Mark Ready to Harvest"
              )}
            </button>
          )}
          {batch.phase === "READY_TO_HARVEST" && (
            <button
              onClick={() => setHarvestOpen(true)}
              className="rounded-lg bg-green px-4 py-2 text-sm font-semibold text-bg hover:bg-green-bright"
            >
              Record Harvest
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-text-dim">
            <Sprout className="h-3 w-3" /> Progress
          </div>
          <p className="font-mono text-xl font-semibold text-text">
            Day {batch.day ?? "--"}{" "}
            <span className="text-sm text-text-dim">
              / {batch.estCycleDays ?? "--"}
            </span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-green transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-text-dim">
            <Heart className="h-3 w-3" /> Health Score
          </div>
          <p
            className={`font-mono text-xl font-semibold ${
              (batch.healthScore ?? 0) >= 80
                ? "text-green"
                : (batch.healthScore ?? 0) >= 60
                  ? "text-amber"
                  : "text-red"
            }`}
          >
            {batch.healthScore ?? "--"}
            <span className="text-sm text-text-dim">%</span>
          </p>
        </div>

        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-text-dim">
            <TrendingUp className="h-3 w-3" /> Yield
          </div>
          <p className="font-mono text-xl font-semibold text-text">
            {(batch.actualYieldKg ?? batch.estYieldKg)?.toFixed(1) ?? "--"}
            <span className="text-sm text-text-dim"> kg</span>
          </p>
          {batch.actualYieldKg && (
            <p className="text-[10px] text-text-dim">actual</p>
          )}
          {!batch.actualYieldKg && batch.estYieldKg && (
            <p className="text-[10px] text-text-dim">estimated</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-text-dim">
            <Calendar className="h-3 w-3" /> Profit
          </div>
          {batch.actualProfit !== null ? (
            <p
              className={`font-mono text-xl font-semibold ${
                batch.actualProfit >= 0 ? "text-green" : "text-red"
              }`}
            >
              {batch.actualProfit.toFixed(0)}
              <span className="text-sm text-text-dim"> kr</span>
            </p>
          ) : batch.estProfit ? (
            <>
              <p className="font-mono text-xl font-semibold text-text">
                {batch.estProfit.toFixed(0)}
                <span className="text-sm text-text-dim"> kr</span>
              </p>
              <p className="text-[10px] text-text-dim">estimated</p>
            </>
          ) : (
            <p className="font-mono text-xl text-text-dim">--</p>
          )}
        </div>
      </div>

      {/* Harvest summary if completed */}
      {batch.harvest && (
        <div className="rounded-xl border border-green/20 bg-green/5 p-4">
          <h3 className="mb-3 text-sm font-medium text-green">
            Harvest Summary
          </h3>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
            <div>
              <p className="text-[10px] text-text-dim">Weight</p>
              <p className="font-mono text-sm text-text">
                {batch.harvest.weightKg.toFixed(1)} kg
              </p>
            </div>
            <div>
              <p className="text-[10px] text-text-dim">Grade</p>
              <p className="font-mono text-sm text-text">
                {batch.harvest.qualityGrade}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-text-dim">Revenue</p>
              <p className="font-mono text-sm text-text">
                {batch.harvest.revenue.toFixed(0)} kr
              </p>
            </div>
            <div>
              <p className="text-[10px] text-text-dim">Cost</p>
              <p className="font-mono text-sm text-text">
                {batch.harvest.totalCost?.toFixed(0) ?? "--"} kr
              </p>
            </div>
            <div>
              <p className="text-[10px] text-text-dim">Profit</p>
              <p className="font-mono text-sm font-semibold text-green">
                {batch.harvest.profit?.toFixed(0) ?? "--"} kr
              </p>
            </div>
            <div>
              <p className="text-[10px] text-text-dim">Cost/g</p>
              <p className="font-mono text-sm text-text">
                {batch.harvest.costPerGram?.toFixed(3) ?? "--"} kr
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Notes section */}
      {(batch.notes || showNoteInput) && (
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <h3 className="mb-2 text-sm font-medium text-text">Notes</h3>
          {batch.notes && (
            <pre className="mb-3 whitespace-pre-wrap text-xs text-text-mid">
              {batch.notes}
            </pre>
          )}
          {showNoteInput && (
            <div className="flex gap-2">
              <input
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addNote()}
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
                placeholder="Add a note..."
                autoFocus
              />
              <button
                onClick={addNote}
                className="rounded-lg bg-green px-3 py-1.5 text-xs font-medium text-bg"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowNoteInput(false);
                  setNoteInput("");
                }}
                className="text-xs text-text-dim hover:text-text-mid"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {!showNoteInput && batch.phase !== "CANCELLED" && (
          <button
            onClick={() => setShowNoteInput(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-mid hover:bg-green/5 hover:text-text"
          >
            <MessageSquare className="h-3 w-3" /> Add Note
          </button>
        )}
        {!["HARVESTED", "CANCELLED"].includes(batch.phase) && (
          <>
            {!confirmCancel ? (
              <button
                onClick={() => setConfirmCancel(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red/20 px-3 py-1.5 text-xs text-red/60 hover:bg-red/5 hover:text-red"
              >
                <XCircle className="h-3 w-3" /> Cancel Batch
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-red/30 bg-red/5 px-3 py-1.5">
                <AlertTriangle className="h-3 w-3 text-red" />
                <span className="text-xs text-red">Cancel this batch?</span>
                <button
                  onClick={cancelBatch}
                  className="rounded bg-red px-2 py-0.5 text-xs font-medium text-white"
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmCancel(false)}
                  className="text-xs text-text-dim"
                >
                  No
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Timeline and Photos */}
      <div className="grid gap-5 lg:grid-cols-2">
        <BatchTimeline batchId={id} />
        <PhotoGallery batchId={id} />
      </div>

      {/* Harvest form modal */}
      <HarvestForm
        open={harvestOpen}
        onClose={() => setHarvestOpen(false)}
        batchId={id}
        cropType={batch?.cropType}
        onCreated={fetchBatch}
      />
    </div>
  );
}
