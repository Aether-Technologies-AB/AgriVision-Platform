"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Loader2 } from "lucide-react";

export default function HarvestForm({
  open,
  onClose,
  batchId,
  cropType,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  batchId: string;
  cropType?: string;
  onCreated: () => void;
}) {
  const [weightKg, setWeightKg] = useState<number>(0);
  const [qualityGrade, setQualityGrade] = useState("A");
  const [pricePerKg, setPricePerKg] = useState<number>(150);
  const [energyCost, setEnergyCost] = useState<number>(0);
  const [substrateCost, setSubstrateCost] = useState<number>(0);
  const [laborCost, setLaborCost] = useState<number>(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Pre-fill costs from farm defaults + batch + energy readings
  useEffect(() => {
    if (!open || prefilled) return;

    // Fetch farm defaults for market price
    fetch("/api/settings/farm")
      .then((r) => r.json())
      .then((farm) => {
        if (farm.defaultMarketPrices && cropType) {
          const price = farm.defaultMarketPrices[cropType];
          if (price) setPricePerKg(price);
        }
      })
      .catch(() => {});

    // Fetch batch details for substrate/labor costs
    fetch(`/api/batches/${batchId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.substrateCost) setSubstrateCost(data.substrateCost);
        if (data.laborCost) setLaborCost(data.laborCost);
      })
      .catch(() => {});

    // Fetch energy cost
    fetch(`/api/batches/${batchId}/energy-cost`)
      .then((r) => r.json())
      .then((data) => {
        if (data.energyCostKr) setEnergyCost(data.energyCostKr);
      })
      .catch(() => {});

    setPrefilled(true);
  }, [open, batchId, cropType, prefilled]);

  // Reset prefilled flag when form closes
  useEffect(() => {
    if (!open) setPrefilled(false);
  }, [open]);

  const computed = useMemo(() => {
    const revenue = weightKg * pricePerKg;
    const totalCost = energyCost + substrateCost + laborCost;
    const profit = revenue - totalCost;
    const costPerGram = weightKg > 0 ? totalCost / (weightKg * 1000) : 0;
    return { revenue, totalCost, profit, costPerGram };
  }, [weightKg, pricePerKg, energyCost, substrateCost, laborCost]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (weightKg <= 0 || pricePerKg <= 0) {
      setError("Weight and price are required");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/harvest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weightKg,
          qualityGrade,
          pricePerKg,
          energyCost: energyCost || 0,
          substrateCost: substrateCost || 0,
          laborCost: laborCost || 0,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to record harvest");
        return;
      }

      onCreated();
      onClose();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-text">Record Harvest</h2>
          <button onClick={onClose} className="text-text-dim hover:text-text">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-xs text-red">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">Weight (kg)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={weightKg || ""}
                onChange={(e) => setWeightKg(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
                placeholder="6.1"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">Quality Grade</label>
              <select
                value={qualityGrade}
                onChange={(e) => setQualityGrade(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
              >
                <option value="A">A - Premium</option>
                <option value="B">B - Standard</option>
                <option value="C">C - Below Standard</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">
              Price per kg (kr){cropType ? ` - ${cropType}` : ""}
            </label>
            <input
              type="number"
              step="1"
              min="1"
              value={pricePerKg || ""}
              onChange={(e) => setPricePerKg(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
              placeholder="150"
            />
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-xs font-medium text-text-mid">Cost Breakdown (kr)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-[10px] text-text-dim">Energy</label>
                <input
                  type="number"
                  step="1"
                  value={energyCost || ""}
                  onChange={(e) => setEnergyCost(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-text focus:border-green focus:outline-none"
                  placeholder="65"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-dim">Substrate</label>
                <input
                  type="number"
                  step="1"
                  value={substrateCost || ""}
                  onChange={(e) => setSubstrateCost(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-text focus:border-green focus:outline-none"
                  placeholder="48"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-dim">Labor</label>
                <input
                  type="number"
                  step="1"
                  value={laborCost || ""}
                  onChange={(e) => setLaborCost(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-text focus:border-green focus:outline-none"
                  placeholder="72"
                />
              </div>
            </div>
          </div>

          {/* Auto-calculated summary */}
          <div className="rounded-lg border border-green/20 bg-green/5 p-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <p className="text-[10px] text-text-dim">Revenue</p>
                <p className="font-mono text-sm text-text">{computed.revenue.toFixed(0)} kr</p>
              </div>
              <div>
                <p className="text-[10px] text-text-dim">Cost</p>
                <p className="font-mono text-sm text-text">{computed.totalCost.toFixed(0)} kr</p>
              </div>
              <div>
                <p className="text-[10px] text-text-dim">Profit</p>
                <p className={`font-mono text-sm font-semibold ${computed.profit >= 0 ? "text-green" : "text-red"}`}>
                  {computed.profit.toFixed(0)} kr
                </p>
              </div>
              <div>
                <p className="text-[10px] text-text-dim">Cost/g</p>
                <p className="font-mono text-sm text-text">{computed.costPerGram.toFixed(3)} kr</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-text-mid hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-green px-4 py-2 text-sm font-semibold text-bg hover:bg-green-bright disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Record Harvest
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
