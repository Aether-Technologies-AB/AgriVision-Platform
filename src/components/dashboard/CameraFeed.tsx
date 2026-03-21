"use client";

import { Camera } from "lucide-react";
import Image from "next/image";

interface PhotoData {
  id: string;
  rgbUrl: string;
  depthUrl: string | null;
  timestamp: string;
}

export default function CameraFeed({ photo }: { photo: PhotoData | null }) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-text-mid" />
          <span className="text-sm font-medium text-text">Camera Feed</span>
        </div>
        {photo && (
          <span className="text-xs text-text-dim">
            {new Date(photo.timestamp).toLocaleString("sv-SE", {
              hour: "2-digit",
              minute: "2-digit",
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-bg">
        {photo ? (
          <Image
            src={photo.rgbUrl}
            alt="Latest zone photo"
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-dim">
            <div className="text-center">
              <Camera className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p>No photos yet</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
