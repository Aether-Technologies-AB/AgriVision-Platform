"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Loader2, CheckSquare, Square } from "lucide-react";

type CropFamily = "MUSHROOM" | "MICROGREEN" | "LEAFY_GREEN";

interface Zone {
  id: string;
  name: string;
  defaultCropFamily: CropFamily | null;
  farm: { id: string; name: string };
}

interface FarmDefaults {
  defaultSubstrateCostPerBag: number;
  defaultLaborCostPerBatch: number;
}

// Variety catalogue per family. Keep these keys in sync with the map in
// src/lib/crop-family.ts so the server-side family inference matches what the
// form presents. "custom" lets the operator type a free-text variety — the
// server-side family resolver falls back to the zone's default when the
// cropType isn't recognized.
const CROPS_BY_FAMILY: Record<CropFamily, { value: string; label: string }[]> = {
  MUSHROOM: [
    { value: "oyster_blue", label: "Oyster (Blue)" },
    { value: "oyster_pink", label: "Oyster (Pink)" },
    { value: "oyster_yellow", label: "Oyster (Yellow)" },
    { value: "lions_mane", label: "Lion's Mane" },
    { value: "shiitake", label: "Shiitake" },
    { value: "custom", label: "Custom" },
  ],
  MICROGREEN: [
    { value: "sakura-radish", label: "Sakura Radish" },
    { value: "radish", label: "Radish" },
    { value: "sunflower", label: "Sunflower Shoots" },
    { value: "pea_shoots", label: "Pea Shoots" },
    { value: "broccoli", label: "Broccoli" },
    { value: "kale", label: "Kale" },
    { value: "arugula", label: "Arugula" },
    { value: "microgreens", label: "Microgreens (mix)" },
    { value: "custom", label: "Custom" },
  ],
  LEAFY_GREEN: [
    { value: "lettuce", label: "Lettuce" },
    { value: "basil", label: "Basil" },
    { value: "custom", label: "Custom" },
  ],
};

const SUBSTRATE_OPTIONS = [
  { value: "straw", label: "Straw" },
  { value: "coffee_mix", label: "Coffee Mix" },
  { value: "sawdust", label: "Sawdust" },
  { value: "custom", label: "Custom" },
];

const FAMILY_LABEL: Record<CropFamily, string> = {
  MUSHROOM: "Mushrooms",
  MICROGREEN: "Microgreens",
  LEAFY_GREEN: "Leafy Greens",
};

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
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [family, setFamily] = useState<CropFamily>("MUSHROOM");
  const [familyTouched, setFamilyTouched] = useState(false);
  const [cropType, setCropType] = useState("oyster_blue");
  const [customCrop, setCustomCrop] = useState("");
  const [substrate, setSubstrate] = useState("straw");
  const [customSubstrate, setCustomSubstrate] = useState("");
  const [bagCount, setBagCount] = useState(10);
  const [trayCount, setTrayCount] = useState(4);
  const [plantCount, setPlantCount] = useState("");
  const [seedingDensity, setSeedingDensity] = useState("");
  const [plantedAt, setPlantedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [substrateCost, setSubstrateCost] = useState("");
  const [laborCost, setLaborCost] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetch("/api/zones")
        .then((r) => r.json())
        .then((d) => {
          setZones(d.zones || []);
          if (d.zones?.length > 0 && selectedZoneIds.length === 0) {
            setSelectedZoneIds([d.zones[0].id]);
          }
        });
      fetch("/api/settings/farm")
        .then((r) => r.json())
        .then((d: FarmDefaults) => {
          if (d.defaultSubstrateCostPerBag) setSubstrateCost(String(d.defaultSubstrateCostPerBag));
          if (d.defaultLaborCostPerBatch) setLaborCost(String(d.defaultLaborCostPerBatch));
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pre-select family from the selected zones' defaults. Only auto-set until
  // the operator explicitly changes the family — after that, honour their
  // choice (a farm might occasionally plant mushrooms in a microgreens zone).
  const zonesDefault = useMemo<CropFamily | null>(() => {
    if (selectedZoneIds.length === 0 || zones.length === 0) return null;
    const selected = zones.filter((z) => selectedZoneIds.includes(z.id));
    const defaults = selected
      .map((z) => z.defaultCropFamily)
      .filter((f): f is CropFamily => f != null);
    if (defaults.length === 0) return null;
    // If every selected zone agrees, use that. Mixed → no auto (leave user's
    // current choice alone).
    const first = defaults[0];
    return defaults.every((f) => f === first) ? first : null;
  }, [selectedZoneIds, zones]);

  useEffect(() => {
    if (!familyTouched && zonesDefault && zonesDefault !== family) {
      setFamily(zonesDefault);
      // Reset cropType to the first variety of the new family.
      setCropType(CROPS_BY_FAMILY[zonesDefault][0].value);
    }
  }, [zonesDefault, familyTouched, family]);

  if (!open) return null;

  const allSelected = zones.length > 0 && selectedZoneIds.length === zones.length;
  const isMushroom = family === "MUSHROOM";
  const isLeafyGreen = family === "LEAFY_GREEN";

  function toggleZone(id: string) {
    setSelectedZoneIds((prev) =>
      prev.includes(id) ? prev.filter((z) => z !== id) : [...prev, id]
    );
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedZoneIds([]);
    } else {
      setSelectedZoneIds(zones.map((z) => z.id));
    }
  }

  function switchFamily(next: CropFamily) {
    setFamily(next);
    setFamilyTouched(true);
    setCropType(CROPS_BY_FAMILY[next][0].value);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const finalCrop = cropType === "custom" ? customCrop.trim() : cropType;
    const finalSubstrate = substrate === "custom" ? customSubstrate.trim() : substrate;

    if (selectedZoneIds.length === 0 || !finalCrop) {
      setError("At least one zone and crop type are required");
      return;
    }
    if (isMushroom && bagCount < 1) {
      setError("Bag count must be at least 1");
      return;
    }
    if (!isMushroom && trayCount < 1) {
      setError("Tray count must be at least 1");
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        zoneIds: selectedZoneIds,
        cropFamily: family,
        cropType: finalCrop,
        plantedAt: plantedAt || null,
        notes: notes || null,
        substrateCost: substrateCost ? Number(substrateCost) : null,
        laborCost: laborCost ? Number(laborCost) : null,
      };
      if (isMushroom) {
        body.substrate = finalSubstrate;
        body.bagCount = bagCount;
      } else {
        body.trayCount = trayCount;
        if (seedingDensity) body.seedingDensityGSqm = Number(seedingDensity);
        if (isLeafyGreen && plantCount) body.plantCount = Number(plantCount);
      }

      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create batch");
        return;
      }

      onCreated();
      onClose();
      // Reset to defaults for the current family so the next open feels
      // consistent with the zone the operator is already on.
      setCropType(CROPS_BY_FAMILY[family][0].value);
      setCustomCrop("");
      setSubstrate("straw");
      setCustomSubstrate("");
      setBagCount(10);
      setTrayCount(4);
      setPlantCount("");
      setSeedingDensity("");
      setPlantedAt("");
      setNotes("");
      setSelectedZoneIds([]);
      setFamilyTouched(false);
      setSubstrateCost("");
      setLaborCost("");
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const CheckIcon = ({ checked }: { checked: boolean }) =>
    checked ? (
      <CheckSquare className="h-4 w-4 text-green" />
    ) : (
      <Square className="h-4 w-4 text-text-dim" />
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
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

          {/* Zone multi-select */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">
              Zones ({selectedZoneIds.length} selected)
            </label>
            <div className="rounded-lg border border-border bg-bg p-2 space-y-1 max-h-36 overflow-y-auto">
              <button
                type="button"
                onClick={toggleAll}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-text hover:bg-green/5"
              >
                <CheckIcon checked={allSelected} />
                <span className="font-medium">All Zones</span>
              </button>
              <div className="mx-1 border-t border-border" />
              {zones.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => toggleZone(z.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-text hover:bg-green/5"
                >
                  <CheckIcon checked={selectedZoneIds.includes(z.id)} />
                  <span className="flex-1 text-left">{z.name}</span>
                  {z.defaultCropFamily && (
                    <span className="text-[10px] text-text-dim">
                      {FAMILY_LABEL[z.defaultCropFamily]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Crop family */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Crop Family</label>
            <div className="flex gap-2">
              {(["MUSHROOM", "MICROGREEN", "LEAFY_GREEN"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => switchFamily(f)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    family === f
                      ? "border-green bg-green/10 text-green"
                      : "border-border bg-bg text-text-mid hover:text-text"
                  }`}
                >
                  {FAMILY_LABEL[f]}
                </button>
              ))}
            </div>
            {zonesDefault && zonesDefault !== family && (
              <p className="mt-1 text-[11px] text-amber">
                Selected zone{selectedZoneIds.length > 1 ? "s" : ""} default to{" "}
                {FAMILY_LABEL[zonesDefault]}.
              </p>
            )}
          </div>

          {/* Crop variety (family-conditional options) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Variety</label>
            <select
              value={cropType}
              onChange={(e) => setCropType(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
            >
              {CROPS_BY_FAMILY[family].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {cropType === "custom" && (
              <input
                type="text"
                value={customCrop}
                onChange={(e) => setCustomCrop(e.target.value)}
                placeholder={
                  isMushroom
                    ? "Enter mushroom variety"
                    : family === "LEAFY_GREEN"
                      ? "Enter leafy green variety"
                      : "Enter microgreen variety"
                }
                className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
              />
            )}
          </div>

          {/* Family-conditional fields */}
          {isMushroom ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-mid">Substrate</label>
                <select
                  value={substrate}
                  onChange={(e) => setSubstrate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
                >
                  {SUBSTRATE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
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
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-mid">Tray Count</label>
                  <input
                    type="number"
                    min={1}
                    value={trayCount}
                    onChange={(e) => setTrayCount(Number(e.target.value))}
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

              {isLeafyGreen && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-mid">
                    Plant Count (optional)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={plantCount}
                    onChange={(e) => setPlantCount(e.target.value)}
                    placeholder="e.g. 32 plants"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-text-dim">
                    Individually-spaced plants across the tray(s) — e.g. 32 basil plants.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-text-mid">
                  Seeding Density (g / m², optional)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={seedingDensity}
                  onChange={(e) => setSeedingDensity(e.target.value)}
                  placeholder="e.g. 30"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
                />
              </div>
            </>
          )}

          {/* Cost defaults — apply to both families */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">
                {isMushroom ? "Substrate Cost (kr/bag)" : "Seed Cost (kr/tray)"}
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={substrateCost}
                onChange={(e) => setSubstrateCost(e.target.value)}
                placeholder="From defaults"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">Labor Cost (kr/batch)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={laborCost}
                onChange={(e) => setLaborCost(e.target.value)}
                placeholder="From defaults"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
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
              {selectedZoneIds.length > 1
                ? `Create ${selectedZoneIds.length} Batches`
                : "Create Batch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
