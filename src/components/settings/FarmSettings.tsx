"use client";

import { useState } from "react";
import { Save, Loader2, Plus, Trash2 } from "lucide-react";

const timezones = [
  "Europe/Stockholm",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Helsinki",
  "US/Eastern",
  "US/Central",
  "US/Pacific",
  "Asia/Tokyo",
  "Asia/Singapore",
];

const commonCrops = [
  "oyster_blue",
  "oyster_pink",
  "oyster_yellow",
  "lions_mane",
  "shiitake",
];

interface FarmData {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  electricityPriceKrPerKwh: number;
  defaultSubstrateCostPerBag: number;
  defaultLaborCostPerBatch: number;
  defaultMarketPrices: Record<string, number> | null;
}

export default function FarmSettings({ farm }: { farm: FarmData }) {
  const [name, setName] = useState(farm.name);
  const [address, setAddress] = useState(farm.address || "");
  const [timezone, setTimezone] = useState(farm.timezone);
  const [electricityPrice, setElectricityPrice] = useState(
    String(farm.electricityPriceKrPerKwh ?? 1.5)
  );
  const [substrateCost, setSubstrateCost] = useState(
    String(farm.defaultSubstrateCostPerBag ?? 15)
  );
  const [laborCost, setLaborCost] = useState(
    String(farm.defaultLaborCostPerBatch ?? 200)
  );

  // Market prices as array of {crop, price} for editable table
  const initPrices = farm.defaultMarketPrices
    ? Object.entries(farm.defaultMarketPrices).map(([crop, price]) => ({ crop, price: String(price) }))
    : commonCrops.map((c) => ({ crop: c, price: "" }));
  const [marketPrices, setMarketPrices] = useState(initPrices);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updatePrice(idx: number, field: "crop" | "price", val: string) {
    setMarketPrices((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p)));
  }

  function addPriceRow() {
    setMarketPrices((prev) => [...prev, { crop: "", price: "" }]);
  }

  function removePriceRow(idx: number) {
    setMarketPrices((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    const pricesObj: Record<string, number> = {};
    for (const { crop, price } of marketPrices) {
      if (crop && price) pricesObj[crop] = Number(price);
    }

    await fetch("/api/settings/farm", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address,
        timezone,
        electricityPriceKrPerKwh: Number(electricityPrice),
        defaultSubstrateCostPerBag: Number(substrateCost),
        defaultLaborCostPerBatch: Number(laborCost),
        defaultMarketPrices: pricesObj,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none";

  return (
    <div className="space-y-5">
      {/* Farm Details */}
      <div className="rounded-xl border border-border bg-bg-card p-5">
        <h3 className="mb-4 text-sm font-medium text-text">Farm Details</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Farm Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputCls}
              placeholder="Farm address"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-mid">Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Cost Defaults */}
      <div className="rounded-xl border border-border bg-bg-card p-5">
        <h3 className="mb-4 text-sm font-medium text-text">Cost Defaults</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">Electricity (kr/kWh)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={electricityPrice}
                onChange={(e) => setElectricityPrice(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">Substrate (kr/bag)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={substrateCost}
                onChange={(e) => setSubstrateCost(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-mid">Labor (kr/batch)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={laborCost}
                onChange={(e) => setLaborCost(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Market prices table */}
          <div>
            <label className="mb-2 block text-xs font-medium text-text-mid">
              Default Market Prices (kr/kg)
            </label>
            <div className="space-y-2">
              {marketPrices.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.crop}
                    onChange={(e) => updatePrice(i, "crop", e.target.value)}
                    placeholder="Crop type"
                    className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
                  />
                  <input
                    type="number"
                    step="1"
                    min={0}
                    value={row.price}
                    onChange={(e) => updatePrice(i, "price", e.target.value)}
                    placeholder="kr/kg"
                    className="w-28 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removePriceRow(i)}
                    className="rounded p-1 text-text-dim hover:text-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addPriceRow}
                className="flex items-center gap-1 text-xs text-green hover:text-green-bright"
              >
                <Plus className="h-3.5 w-3.5" />
                Add crop
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg bg-green px-4 py-2 text-sm font-semibold text-bg hover:bg-green-bright disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saved ? "Saved!" : "Save Changes"}
      </button>
    </div>
  );
}
