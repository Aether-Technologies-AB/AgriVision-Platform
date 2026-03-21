"use client";

import { useState, useEffect } from "react";
import {
  Thermometer,
  Droplets,
  Wind,
  Gauge,
  Wifi,
  WifiOff,
  AlertCircle,
  ChevronDown,
  Clock,
} from "lucide-react";
import SensorCard from "@/components/dashboard/SensorCard";
import EnvironmentChart from "@/components/dashboard/EnvironmentChart";
import ActiveBatchCard from "@/components/dashboard/ActiveBatchCard";
import CameraFeed from "@/components/dashboard/CameraFeed";
import AIDecisionFeed from "@/components/dashboard/AIDecisionFeed";
import DeviceControl from "@/components/dashboard/DeviceControl";
import { usePolling } from "@/lib/use-polling";

interface Zone {
  id: string;
  name: string;
  agentStatus: string;
  currentPhase: string;
  farm: { name: string };
}

interface LiveData {
  sensor: {
    temperature: number;
    humidity: number;
    co2: number | null;
    vpd: number | null;
    timestamp: string;
  } | null;
  sensorPrev: {
    temperature: number;
    humidity: number;
    co2: number | null;
    vpd: number | null;
  } | null;
  devices: {
    id: string;
    type: string;
    name: string;
    state: boolean;
    lastToggled: string | null;
  }[];
  agent: {
    status: string;
    lastSeen: string | null;
    autoMode: boolean;
    phase: string;
  };
  latestPhoto: {
    id: string;
    rgbUrl: string;
    depthUrl: string | null;
    timestamp: string;
  } | null;
  activeBatch: {
    id: string;
    batchNumber: string;
    cropType: string;
    phase: string;
    day: number | null;
    estCycleDays: number | null;
    estHarvestDate: string | null;
    estYieldKg: number | null;
    healthScore: number | null;
  } | null;
  recentDecisions: {
    id: string;
    decisionType: string;
    decision: string;
    reasoning: string;
    actionTaken: string | null;
    costKr: number | null;
    timestamp: string;
  }[];
}

function formatLastSeen(ts: string | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - new Date(ts).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function CurrentClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    function tick() {
      setTime(
        new Date().toLocaleTimeString("sv-SE", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-sm text-text-mid">{time}</span>
  );
}

export default function DashboardPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Fetch zones on mount
  useEffect(() => {
    fetch("/api/zones")
      .then((r) => r.json())
      .then((d) => {
        setZones(d.zones || []);
        if (d.zones?.length > 0 && !selectedZoneId) {
          setSelectedZoneId(d.zones[0].id);
        }
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll live data for selected zone
  const { data: live, isStale, lastUpdated } = usePolling<LiveData>({
    url: selectedZoneId
      ? `/api/dashboard/live/${selectedZoneId}`
      : null,
    intervalMs: 10_000,
    enabled: !!selectedZoneId,
  });

  const selectedZone = zones.find((z) => z.id === selectedZoneId);
  const agentOnline = live?.agent?.status === "ONLINE";

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Zone selector */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2 text-sm font-medium text-text transition-colors hover:border-green/30"
            >
              {selectedZone ? (
                <>
                  <span>{selectedZone.farm.name}</span>
                  <span className="text-text-dim">/</span>
                  <span>{selectedZone.name}</span>
                </>
              ) : (
                <span className="text-text-dim">Select zone...</span>
              )}
              <ChevronDown className="h-4 w-4 text-text-dim" />
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-bg-card py-1 shadow-xl">
                {zones.map((z) => (
                  <button
                    key={z.id}
                    onClick={() => {
                      setSelectedZoneId(z.id);
                      setDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-green/5 ${
                      z.id === selectedZoneId
                        ? "text-green"
                        : "text-text"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        z.agentStatus === "ONLINE"
                          ? "bg-green"
                          : z.agentStatus === "ERROR"
                            ? "bg-red"
                            : "bg-text-dim"
                      }`}
                    />
                    <span>
                      {z.farm.name} / {z.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Agent status */}
          <div className="flex items-center gap-2">
            {agentOnline ? (
              <Wifi className="h-4 w-4 text-green" />
            ) : (
              <WifiOff className="h-4 w-4 text-text-dim" />
            )}
            <span
              className={`text-xs ${
                agentOnline ? "text-green" : "text-text-dim"
              }`}
            >
              {live?.agent?.status || "OFFLINE"}
            </span>
            <span className="text-xs text-text-dim">
              {formatLastSeen(live?.agent?.lastSeen ?? null)}
            </span>
          </div>

          {/* Stale indicator */}
          {isStale && (
            <div className="flex items-center gap-1 rounded-md bg-amber/10 px-2 py-1 text-xs text-amber">
              <AlertCircle className="h-3 w-3" />
              Stale data
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="flex items-center gap-1 text-xs text-text-dim">
              <Clock className="h-3 w-3" />
              Updated{" "}
              {lastUpdated.toLocaleTimeString("sv-SE", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
          <CurrentClock />
        </div>
      </div>

      {/* Main grid */}
      {selectedZoneId ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Left column - 3/5 */}
          <div className="space-y-4 lg:col-span-3">
            {/* Sensor cards */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <SensorCard
                label="Temperature"
                value={live?.sensor?.temperature ?? null}
                prevValue={live?.sensorPrev?.temperature ?? null}
                unit="°C"
                icon={<Thermometer className="h-4 w-4" />}
                goodRange={[15, 20]}
                warnRange={[12, 22]}
              />
              <SensorCard
                label="Humidity"
                value={live?.sensor?.humidity ?? null}
                prevValue={live?.sensorPrev?.humidity ?? null}
                unit="%"
                icon={<Droplets className="h-4 w-4" />}
                goodRange={[85, 95]}
                warnRange={[75, 98]}
              />
              <SensorCard
                label="CO₂"
                value={live?.sensor?.co2 ?? null}
                prevValue={live?.sensorPrev?.co2 ?? null}
                unit="ppm"
                icon={<Wind className="h-4 w-4" />}
                decimals={0}
                goodRange={[400, 1000]}
                warnRange={[300, 1200]}
              />
              <SensorCard
                label="VPD"
                value={live?.sensor?.vpd ?? null}
                prevValue={live?.sensorPrev?.vpd ?? null}
                unit="kPa"
                icon={<Gauge className="h-4 w-4" />}
                decimals={2}
                goodRange={[0.3, 0.8]}
                warnRange={[0.2, 1.0]}
              />
            </div>

            {/* Environment chart */}
            <EnvironmentChart zoneId={selectedZoneId} />

            {/* Active batch */}
            <ActiveBatchCard batch={live?.activeBatch ?? null} />
          </div>

          {/* Right column - 2/5 */}
          <div className="space-y-4 lg:col-span-2">
            {/* Camera feed */}
            <CameraFeed photo={live?.latestPhoto ?? null} />

            {/* AI Decisions */}
            <AIDecisionFeed decisions={live?.recentDecisions ?? []} />

            {/* Device control */}
            <DeviceControl
              devices={live?.devices ?? []}
              zoneId={selectedZoneId}
              autoMode={live?.agent?.autoMode ?? true}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-bg-card p-12 text-center text-text-dim">
          Select a zone to view live data
        </div>
      )}
    </div>
  );
}
