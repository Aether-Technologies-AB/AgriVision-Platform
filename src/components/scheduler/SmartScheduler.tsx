"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronUp, Loader2, Sparkles, Plus } from "lucide-react";

const cropOptions = [
  { value: "oyster_blue", label: "Oyster (Blue)" },
  { value: "oyster_pink", label: "Oyster (Pink)" },
  { value: "oyster_yellow", label: "Oyster (Yellow)" },
  { value: "lions_mane", label: "Lion's Mane" },
  { value: "shiitake", label: "Shiitake" },
];

interface Plan {
  plantDate: string;
  zone: string;
  bagCount: number;
  estHarvestDate: string;
  bufferDays: number;
  confidence: number;
  reasoning: string;
}

export default function SmartScheduler({ onCreateBatch }: { onCreateBatch: (plan: Plan) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [quantityKg, setQuantityKg] = useState<number>(5);
  const [cropType, setCropType] = useState("oyster_blue");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [showReasoning, setShowReasoning] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!deliveryDate || !quantityKg) return;

    setLoading(true);
    setError("");
    setPlan(null);

    try {
      const res = await fetch("/api/schedule/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryDate, quantityKg, cropType, customerName }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate plan");
        return;
      }
      setPlan(data.plan);
    } catch {
      setError("Failed to connect to AI");
    } finally {
      setLoading(false);
    }
  }

  const cropLabel = cropOptions.find((c) => c.value === cropType)?.label || cropType;

  return (
    <div className="rounded-xl border border-purple/20 bg-purple/5">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple" />
          <span className="text-sm font-medium text-text">Smart Scheduler</span>
          <span className="rounded-full bg-purple/15 px-2 py-0.5 text-[10px] font-medium text-purple">
            AI-Powered
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-text-dim" />
        ) : (
          <ChevronDown className="h-4 w-4 text-text-dim" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-purple/10 px-4 pb-4 pt-3">
          <p className="mb-3 text-xs text-text-mid">
            Enter a delivery date and quantity. AI will calculate the optimal planting plan based on your historical batch performance.
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium text-text-dim">Delivery Date</label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-text focus:border-purple focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium text-text-dim">Quantity (kg)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={quantityKg}
                  onChange={(e) => setQuantityKg(Number(e.target.value))}
                  required
                  className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-text focus:border-purple focus:outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium text-text-dim">Crop Type</label>
                <select
                  value={cropType}
                  onChange={(e) => setCropType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-text focus:border-purple focus:outline-none"
                >
                  {cropOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium text-text-dim">Customer (optional)</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Restaurant Norra"
                  className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-text placeholder:text-text-dim focus:border-purple focus:outline-none"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white hover:bg-purple/80 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {loading ? "Calculating..." : "Calculate Plan"}
            </button>
          </form>

          {error && (
            <div className="mt-3 rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-xs text-red">
              {error}
            </div>
          )}

          {/* Plan result */}
          {plan && (
            <div className="mt-4 rounded-lg border border-green/20 bg-green/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-green" />
                <span className="text-sm font-medium text-green">Recommended Plan</span>
              </div>
              <p className="text-sm text-text">
                Plant <span className="font-semibold text-green">{plan.bagCount} bags</span> of{" "}
                <span className="font-semibold">{cropLabel}</span> in{" "}
                <span className="font-semibold">{plan.zone}</span> on{" "}
                <span className="font-mono font-semibold">{plan.plantDate}</span>.
              </p>
              <p className="mt-1 text-sm text-text-mid">
                Expected harvest: <span className="font-mono">{plan.estHarvestDate}</span>{" "}
                ({plan.bufferDays} day buffer). Confidence:{" "}
                <span className={`font-semibold ${plan.confidence >= 0.8 ? "text-green" : plan.confidence >= 0.6 ? "text-amber" : "text-red"}`}>
                  {Math.round(plan.confidence * 100)}%
                </span>
              </p>

              {/* Reasoning */}
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className="mt-2 text-xs text-text-dim hover:text-text-mid"
              >
                {showReasoning ? "Hide" : "Show"} reasoning
              </button>
              {showReasoning && (
                <p className="mt-1 text-xs text-text-mid">{plan.reasoning}</p>
              )}

              {/* Create batch button */}
              <button
                onClick={() => onCreateBatch(plan)}
                className="mt-3 flex items-center gap-1.5 rounded-lg bg-green px-3 py-1.5 text-xs font-semibold text-bg hover:bg-green-bright"
              >
                <Plus className="h-3 w-3" />
                Create Batch from Plan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
