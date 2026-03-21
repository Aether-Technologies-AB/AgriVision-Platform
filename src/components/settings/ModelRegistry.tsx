"use client";

import { useState, useEffect } from "react";
import { Brain, CheckCircle, XCircle } from "lucide-react";

interface MLModelData {
  id: string;
  name: string;
  version: string;
  cropType: string;
  fileSizeMb: number;
  accuracy: number | null;
  trainedOn: string | null;
  epochs: number | null;
  isActive: boolean;
  createdAt: string;
}

const cropLabels: Record<string, string> = {
  all: "All Crops",
  oyster: "Oyster",
  lions_mane: "Lion's Mane",
  shiitake: "Shiitake",
};

export default function ModelRegistry() {
  const [models, setModels] = useState<MLModelData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/models")
      .then((r) => r.json())
      .then((d) => { setModels(d.models || []); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-5 text-center text-sm text-text-dim">
        Loading models...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-card">
        <div className="border-b border-border px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple" />
              <h3 className="text-sm font-medium text-text">ML Models</h3>
            </div>
            <span className="text-xs text-text-dim">{models.length} models</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-dim">Model</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-dim">Version</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-dim">Crop</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-dim">Size</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-dim">Accuracy</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-dim">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-text-dim">Created</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-b border-border/50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-text">{m.name.replace(/_/g, " ")}</p>
                    {m.trainedOn && <p className="text-[10px] text-text-dim">{m.trainedOn}</p>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-text-mid">{m.version}</td>
                  <td className="px-4 py-2.5 text-text-mid">{cropLabels[m.cropType] || m.cropType}</td>
                  <td className="px-4 py-2.5 font-mono text-text-mid">{m.fileSizeMb.toFixed(1)} MB</td>
                  <td className="px-4 py-2.5 font-mono text-text-mid">
                    {m.accuracy ? `${(m.accuracy * 100).toFixed(0)}%` : "--"}
                  </td>
                  <td className="px-4 py-2.5">
                    {m.isActive ? (
                      <span className="flex items-center gap-1 text-xs text-green">
                        <CheckCircle className="h-3 w-3" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-text-dim">
                        <XCircle className="h-3 w-3" /> Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-dim">
                    {new Date(m.createdAt).toLocaleDateString("sv-SE")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-text-dim">
        Model management and training pipeline coming soon. Models are deployed via the Pi agent&apos;s model update mechanism.
      </p>
    </div>
  );
}
