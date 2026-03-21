"use client";

import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";

interface Zone {
  id: string;
  name: string;
  farm: { name: string };
}

const cropOptions = [
  { value: "oyster_blue", label: "Oyster (Blue)" },
  { value: "oyster_pink", label: "Oyster (Pink)" },
  { value: "oyster_yellow", label: "Oyster (Yellow)" },
  { value: "lions_mane", label: "Lion's Mane" },
  { value: "shiitake", label: "Shiitake" },
  { value: "custom", label: "Custom" },
];

const substrateOptions = [
  { value: "straw", label: "Straw" },
  { value: "coffee_mix", label: "Coffee Mix" },
  { value: "sawdust", label: "Sawdust" },
  { value: "custom", label: "Custom" },
];

export default function BatchForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [cropType, setCropType] = useState("oyster_blue");
  const [customCrop, setCustomCrop] = useState("");
  const [substrate, setSubstrate] = useState("straw");
  const [customSubstrate, setCustomSubstrate] = useState("");
  const [bagCount, setBagCount] = useState(10);
  const [plantedAt, setPlantedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetch("/api/zones")
        .then((r) => r.json())
        .then((d) => {
          setZones(d.zones || []);
          if (d.zones?.length > 0 && !zoneId) setZoneId(d.zones[0].id);
        });
    }
  }, [open, zoneId]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const finalCrop = cropType === "custom" ? customCrop : cropType;
    const finalSubstrate = substrate === "custom" ? customSubstrate : substrate;

    if (!zoneId || !finalCrop) {
      setError("Zone and crop type are required");
      return;
    }
    if (bagCount < 1) {
      setError("Bag count must be at least 1");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoneId,
          cropType: finalCrop,
          substrate: finalSubstrate,
          bagCount,
          plantedAt: plantedAt || null,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create batch");
        return;
      }

      onCreated();
      onClose();
      // Reset form
      setCropType("oyster_blue");
      setSubstrate("straw");
      setBagCount(10);
      setPlantedAt("");
      setNotes("");
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
          <h2 className="text-lg font-semibold text-text">New Batch</h2>
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

          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Zone</label>
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.farm.name} / {z.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Crop Type</label>
            <select
              value={cropType}
              onChange={(e) => setCropType(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
            >
              {cropOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {cropType === "custom" && (
              <input
                type="text"
                value={customCrop}
                onChange={(e) => setCustomCrop(e.target.value)}
                placeholder="Enter crop name"
                className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Substrate</label>
            <select
              value={substrate}
              onChange={(e) => setSubstrate(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
            >
              {substrateOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {substrate === "custom" && (
              <input
                type="text"
                value={customSubstrate}
                onChange={(e) => setCustomSubstrate(e.target.value)}
                placeholder="Enter substrate"
                className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">Bag Count</label>
              <input
                type="number"
                min={1}
                value={bagCount}
                onChange={(e) => setBagCount(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">Plant Date</label>
              <input
                type="date"
                value={plantedAt}
                onChange={(e) => setPlantedAt(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
              placeholder="Any special notes about this batch..."
            />
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
              Create Batch
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
