"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";

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

interface FarmData {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
}

export default function FarmSettings({ farm }: { farm: FarmData }) {
  const [name, setName] = useState(farm.name);
  const [address, setAddress] = useState(farm.address || "");
  const [timezone, setTimezone] = useState(farm.timezone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    await fetch("/api/settings/farm", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, address, timezone }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      <h3 className="mb-4 text-sm font-medium text-text">Farm Details</h3>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-mid">Farm Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-mid">Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-green focus:outline-none"
            placeholder="Farm address"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-mid">Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-green focus:outline-none"
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-green px-4 py-2 text-sm font-semibold text-bg hover:bg-green-bright disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? "Saved!" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
