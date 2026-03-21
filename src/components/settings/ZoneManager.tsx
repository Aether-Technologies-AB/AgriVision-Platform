"use client";

import { useState } from "react";
import {
  Wifi,
  WifiOff,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Loader2,
} from "lucide-react";

interface ZoneData {
  id: string;
  name: string;
  cameraType: string | null;
  sensorUrl: string | null;
  plugIds: unknown;
  agentStatus: string;
  currentPhase: string;
  activeBatchCount: number;
}

const cameraOptions = [
  { value: "", label: "None" },
  { value: "realsense_d435", label: "Intel RealSense D435" },
  { value: "wyze_cam", label: "Wyze Cam" },
  { value: "phone", label: "Phone Camera" },
  { value: "other", label: "Other" },
];

const statusIcons: Record<string, React.ReactNode> = {
  ONLINE: <Wifi className="h-3.5 w-3.5 text-green" />,
  OFFLINE: <WifiOff className="h-3.5 w-3.5 text-text-dim" />,
  ERROR: <AlertCircle className="h-3.5 w-3.5 text-red" />,
};

export default function ZoneManager({
  zones,
  onRefresh,
}: {
  zones: ZoneData[];
  onRefresh: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [formName, setFormName] = useState("");
  const [formCamera, setFormCamera] = useState("");
  const [formSensor, setFormSensor] = useState("");
  const [formPlugs, setFormPlugs] = useState("");

  function startEdit(z: ZoneData) {
    setEditingId(z.id);
    setFormName(z.name);
    setFormCamera(z.cameraType || "");
    setFormSensor(z.sensorUrl || "");
    setFormPlugs(z.plugIds ? JSON.stringify(z.plugIds) : "");
    setAddingNew(false);
  }

  function startAdd() {
    setAddingNew(true);
    setEditingId(null);
    setFormName("");
    setFormCamera("");
    setFormSensor("");
    setFormPlugs("");
  }

  function cancelEdit() {
    setEditingId(null);
    setAddingNew(false);
  }

  async function saveEdit() {
    setSaving(true);
    let plugIds = null;
    if (formPlugs.trim()) {
      try { plugIds = JSON.parse(formPlugs); } catch { plugIds = null; }
    }

    const body = { name: formName, cameraType: formCamera || null, sensorUrl: formSensor || null, plugIds };

    if (addingNew) {
      await fetch("/api/settings/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else if (editingId) {
      await fetch(`/api/settings/zones/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    setSaving(false);
    cancelEdit();
    onRefresh();
  }

  async function deleteZone(id: string) {
    const res = await fetch(`/api/settings/zones/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete zone");
      return;
    }
    onRefresh();
  }

  function EditForm() {
    return (
      <div className="space-y-2 rounded-lg border border-green/20 bg-green/5 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-[10px] text-text-dim">Name</label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] text-text-dim">Camera</label>
            <select
              value={formCamera}
              onChange={(e) => setFormCamera(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
            >
              {cameraOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-text-dim">Sensor URL</label>
          <input
            value={formSensor}
            onChange={(e) => setFormSensor(e.target.value)}
            placeholder="http://192.168.1.100:8080"
            className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-green focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-text-dim">Plug IDs (JSON array)</label>
          <input
            value={formPlugs}
            onChange={(e) => setFormPlugs(e.target.value)}
            placeholder='["192.168.1.101", "192.168.1.102"]'
            className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-green focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={saveEdit}
            disabled={saving || !formName}
            className="flex items-center gap-1 rounded-lg bg-green px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          <button onClick={cancelEdit} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-text-dim hover:text-text-mid">
            <X className="h-3 w-3" /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Zones</h3>
        <button
          onClick={startAdd}
          className="flex items-center gap-1 rounded-lg bg-green/15 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/25"
        >
          <Plus className="h-3 w-3" /> Add Zone
        </button>
      </div>

      <div className="space-y-3">
        {addingNew && <EditForm />}

        {zones.map((z) => (
          <div key={z.id}>
            {editingId === z.id ? (
              <EditForm />
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                <div className="flex items-center gap-3">
                  {statusIcons[z.agentStatus] || statusIcons.OFFLINE}
                  <div>
                    <p className="text-sm font-medium text-text">{z.name}</p>
                    <p className="text-[10px] text-text-dim">
                      {z.cameraType || "No camera"} &middot; {z.currentPhase}
                      {z.activeBatchCount > 0 && ` &middot; ${z.activeBatchCount} active batch${z.activeBatchCount > 1 ? "es" : ""}`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(z)} className="rounded p-1.5 text-text-dim hover:bg-green/10 hover:text-green">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${z.name}? This cannot be undone.`)) deleteZone(z.id);
                    }}
                    className="rounded p-1.5 text-text-dim hover:bg-red/10 hover:text-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
