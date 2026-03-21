"use client";

import { useState, useEffect } from "react";
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Loader2 } from "lucide-react";

interface ApiKeyData {
  id: string;
  name: string;
  prefix: string;
  farmId: string | null;
  farm: { name: string } | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Farm {
  id: string;
  name: string;
}

export default function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKeyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyFarmId, setNewKeyFarmId] = useState("");
  const [creating, setCreating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [farms, setFarms] = useState<Farm[]>([]);

  useEffect(() => {
    fetchKeys();
    fetch("/api/settings/farm")
      .then((r) => r.json())
      .then((d) => {
        if (d.id) setFarms([{ id: d.id, name: d.name }]);
      });
  }, []);

  function fetchKeys() {
    setLoading(true);
    fetch("/api/settings/api-keys")
      .then((r) => r.json())
      .then((d) => {
        setKeys(d.keys || []);
        setLoading(false);
      });
  }

  async function createKey() {
    setCreating(true);
    const res = await fetch("/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName, farmId: newKeyFarmId || null }),
    });
    const data = await res.json();
    setCreating(false);
    if (res.ok) {
      setGeneratedKey(data.key);
      setShowForm(false);
      setNewKeyName("");
      fetchKeys();
    }
  }

  async function revokeKey(id: string) {
    await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
    fetchKeys();
  }

  function copyKey() {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-text">API Keys</h3>
          <button
            onClick={() => { setShowForm(true); setGeneratedKey(null); }}
            className="flex items-center gap-1 rounded-lg bg-green/15 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/25"
          >
            <Plus className="h-3 w-3" /> Generate New Key
          </button>
        </div>

        {/* Generated key banner */}
        {generatedKey && (
          <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber">
              <AlertTriangle className="h-3.5 w-3.5" />
              Copy this key now. You won&apos;t be able to see it again.
            </div>
            <div className="flex gap-2">
              <code className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text">
                {generatedKey}
              </code>
              <button
                onClick={copyKey}
                className="flex items-center gap-1 rounded-lg bg-amber px-3 py-2 text-xs font-semibold text-bg"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {/* New key form */}
        {showForm && (
          <div className="mb-4 rounded-lg border border-green/20 bg-green/5 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-[10px] text-text-dim">Key Name</label>
                <input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Pi Agent - Zone A"
                  className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-green focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] text-text-dim">Farm Scope</label>
                <select
                  value={newKeyFarmId}
                  onChange={(e) => setNewKeyFarmId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text focus:border-green focus:outline-none"
                >
                  <option value="">All farms</option>
                  {farms.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={createKey}
                disabled={creating || !newKeyName}
                className="flex items-center gap-1 rounded-lg bg-green px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Key className="h-3 w-3" />}
                Generate
              </button>
              <button onClick={() => setShowForm(false)} className="text-xs text-text-dim hover:text-text-mid">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Keys list */}
        {loading ? (
          <p className="text-sm text-text-dim">Loading keys...</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-text-dim">No API keys yet</p>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <Key className="h-4 w-4 text-text-dim" />
                  <div>
                    <p className="text-sm font-medium text-text">{k.name}</p>
                    <p className="text-[10px] text-text-dim">
                      <code className="font-mono">{k.prefix}...</code>
                      {k.farm && <> &middot; {k.farm.name}</>}
                      &middot; Created {new Date(k.createdAt).toLocaleDateString("sv-SE")}
                      {k.lastUsedAt && <> &middot; Last used {new Date(k.lastUsedAt).toLocaleDateString("sv-SE")}</>}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Revoke key "${k.name}"? This cannot be undone.`)) revokeKey(k.id);
                  }}
                  className="rounded p-1.5 text-text-dim hover:bg-red/10 hover:text-red"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
