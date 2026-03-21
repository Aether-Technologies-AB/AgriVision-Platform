"use client";

import { useState, useEffect } from "react";
import { X, Camera } from "lucide-react";
import Image from "next/image";

interface Photo {
  id: string;
  rgbUrl: string;
  analysis: Record<string, unknown> | null;
  timestamp: string;
}

interface TimelineData {
  events: {
    id: string;
    type: string;
    subtype: string;
    timestamp: string;
    meta?: Record<string, unknown>;
  }[];
}

export default function PhotoGallery({ batchId }: { batchId: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/batches/${batchId}/timeline`)
      .then((r) => r.json())
      .then((data: TimelineData) => {
        const p = (data.events || [])
          .filter((e) => e.type === "photo" && e.meta?.rgbUrl)
          .map((e) => ({
            id: e.id,
            rgbUrl: e.meta!.rgbUrl as string,
            analysis: (e.meta?.analysis as Record<string, unknown>) || null,
            timestamp: e.timestamp,
          }));
        setPhotos(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [batchId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-text-dim">
        Loading photos...
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-6 text-center text-sm text-text-dim">
        <Camera className="mx-auto mb-2 h-6 w-6 opacity-40" />
        No photos for this batch
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-text">
          Photos ({photos.length})
        </h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className="group relative aspect-video overflow-hidden rounded-lg border border-border bg-bg"
            >
              <Image
                src={p.rgbUrl}
                alt="Batch photo"
                fill
                className="object-cover transition-transform group-hover:scale-105"
                unoptimized
              />
              <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
              <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                {new Date(p.timestamp).toLocaleDateString("sv-SE", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Expanded photo modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="relative w-full max-w-3xl">
            <button
              onClick={() => setSelected(null)}
              className="absolute -top-10 right-0 text-white hover:text-text"
            >
              <X className="h-6 w-6" />
            </button>
            <div className="relative aspect-video overflow-hidden rounded-xl border border-border">
              <Image
                src={selected.rgbUrl}
                alt="Batch photo expanded"
                fill
                className="object-contain"
                unoptimized
              />
            </div>
            {selected.analysis && (
              <div className="mt-3 rounded-lg border border-border bg-bg-card p-3">
                <p className="mb-2 text-xs font-medium text-text-mid">
                  ML Analysis
                </p>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {Object.entries(selected.analysis).map(([key, val]) => (
                    <div key={key}>
                      <p className="text-[10px] text-text-dim">
                        {key.replace(/_/g, " ")}
                      </p>
                      <p className="font-mono text-xs text-text">
                        {typeof val === "number" ? val.toFixed(1) : String(val)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-2 text-center text-xs text-text-dim">
              {new Date(selected.timestamp).toLocaleString("sv-SE")}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
