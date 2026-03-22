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
  Building2,
  LayoutGrid,
  Zap,
} from "lucide-react";
import SensorCard from "@/components/dashboard/SensorCard";
import EnvironmentChart from "@/components/dashboard/EnvironmentChart";
import ActiveBatchCard from "@/components/dashboard/ActiveBatchCard";
import CameraFeed from "@/components/dashboard/CameraFeed";
import AIDecisionFeed from "@/components/dashboard/AIDecisionFeed";
import DeviceControl from "@/components/dashboard/DeviceControl";
import EnergyChart from "@/components/dashboard/EnergyChart";
import ZoneMap from "@/components/dashboard/ZoneMap";
import { usePolling } from "@/lib/use-polling";

interface Farm {
  id: string;
  name: string;
  zoneCount: number;
}

interface Zone {
  id: string;
  name: string;
  agentStatus: string;
  currentPhase: string;
  farm: { id: string; name: string };
}

interface ZoneMapData {
  id: string;
  name: string;
  agentStatus: string;
  agentLastSeen: string | null;
  currentPhase: string;
  batches: {
    id: string;
    batchNumber: string;
    cropType: string;
    phase: string;
    day: number | null;
    estCycleDays: number | null;
    healthScore: number | null;
  }[];
  sensor: {
    temperature: number;
    humidity: number;
    timestamp: string;
  } | null;
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
  energy: {
    todayKwh: number;
    todayCostKr: number;
  };
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
  return <span className="font-mono text-sm text-text-mid">{time}</span>;
}

export default function DashboardPage() {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [farmDropdownOpen, setFarmDropdownOpen] = useState(false);

  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null); // null = "All Zones"
  const [zoneDropdownOpen, setZoneDropdownOpen] = useState(false);

  // Zone map data (detail=true)
  const [zoneMapData, setZoneMapData] = useState<ZoneMapData[]>([]);

  // Fetch farms on mount
  useEffect(() => {
    fetch("/api/farms")
      .then((r) => r.json())
      .then((d) => {
        setFarms(d.farms || []);
        if (d.farms?.length > 0 && !selectedFarmId) {
          setSelectedFarmId(d.farms[0].id);
        }
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch zones when farm changes
  useEffect(() => {
    if (!selectedFarmId) return;
    const farmParam = `farmId=${selectedFarmId}`;

    // Simple list for dropdown
    fetch(`/api/zones?${farmParam}`)
      .then((r) => r.json())
      .then((d) => setZones(d.zones || []))
      .catch(console.error);

    // Detail data for zone map
    fetch(`/api/zones?${farmParam}&detail=true`)
      .then((r) => r.json())
      .then((d) => setZoneMapData(d.zones || []))
      .catch(console.error);

    // Reset zone selection to "All Zones" when switching farms
    setSelectedZoneId(null);
  }, [selectedFarmId]);

  // Refresh zone map every 30s
  useEffect(() => {
    if (!selectedFarmId || selectedZoneId) return; // only when viewing All Zones
    const id = setInterval(() => {
      fetch(`/api/zones?farmId=${selectedFarmId}&detail=true`)
        .then((r) => r.json())
        .then((d) => setZoneMapData(d.zones || []))
        .catch(console.error);
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedFarmId, selectedZoneId]);

  // Poll live data for selected zone
  const { data: live, isStale, lastUpdated } = usePolling<LiveData>({
    url: selectedZoneId ? `/api/dashboard/live/${selectedZoneId}` : null,
    intervalMs: 10_000,
    enabled: !!selectedZoneId,
  });

  const selectedZone = zones.find((z) => z.id === selectedZoneId);
  const selectedFarm = farms.find((f) => f.id === selectedFarmId);
  const agentOnline = live?.agent?.status === "ONLINE";

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Farm selector */}
          {farms.length > 1 && (
            <div className="relative">
              <button
                onClick={() => {
                  setFarmDropdownOpen(!farmDropdownOpen);
                  setZoneDropdownOpen(false);
                }}
                className="flex items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2 text-sm font-medium text-text transition-colors hover:border-green/30"
              >
                <Building2 className="h-3.5 w-3.5 text-text-dim" />
                {selectedFarm?.name || "Select farm..."}
                <ChevronDown className="h-3.5 w-3.5 text-text-dim" />
              </button>
              {farmDropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-bg-card py-1 shadow-xl">
                  {farms.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setSelectedFarmId(f.id);
                        setFarmDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-green/5 ${
                        f.id === selectedFarmId ? "text-green" : "text-text"
                      }`}
                    >
                      <span>{f.name}</span>
                      <span className="text-[10px] text-text-dim">{f.zoneCount} zones</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Zone selector */}
          <div className="relative">
            <button
              onClick={() => {
                setZoneDropdownOpen(!zoneDropdownOpen);
                setFarmDropdownOpen(false);
              }}
              className="flex items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2 text-sm font-medium text-text transition-colors hover:border-green/30"
            >
              {farms.length <= 1 && selectedFarm && (
                <>
                  <span className="text-text-mid">{selectedFarm.name}</span>
                  <span className="text-text-dim">/</span>
                </>
              )}
              {selectedZone ? (
                <span>{selectedZone.name}</span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  All Zones
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-text-dim" />
            </button>
            {zoneDropdownOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-bg-card py-1 shadow-xl">
                <button
                  onClick={() => {
                    setSelectedZoneId(null);
                    setZoneDropdownOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-green/5 ${
                    !selectedZoneId ? "text-green" : "text-text"
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  All Zones
                </button>
                <div className="mx-2 my-1 border-t border-border" />
                {zones.map((z) => (
                  <button
                    key={z.id}
                    onClick={() => {
                      setSelectedZoneId(z.id);
                      setZoneDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-green/5 ${
                      z.id === selectedZoneId ? "text-green" : "text-text"
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
                    {z.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Agent status — only when a zone is selected */}
          {selectedZoneId && (
            <div className="flex items-center gap-2">
              {agentOnline ? (
                <Wifi className="h-4 w-4 text-green" />
              ) : (
                <WifiOff className="h-4 w-4 text-text-dim" />
              )}
              <span className={`text-xs ${agentOnline ? "text-green" : "text-text-dim"}`}>
                {live?.agent?.status || "OFFLINE"}
              </span>
              <span className="text-xs text-text-dim">
                {formatLastSeen(live?.agent?.lastSeen ?? null)}
              </span>
            </div>
          )}

          {isStale && (
            <div className="flex items-center gap-1 rounded-md bg-amber/10 px-2 py-1 text-xs text-amber">
              <AlertCircle className="h-3 w-3" />
              Stale data
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && selectedZoneId && (
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

      {/* Content: All Zones view or single-zone detail */}
      {!selectedZoneId ? (
        /* ── All Zones: Zone Map ── */
        <ZoneMap
          zones={zoneMapData}
          onSelectZone={(id) => setSelectedZoneId(id)}
        />
      ) : (
        /* ── Single Zone: Detail view ── */
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Left column - 3/5 */}
          <div className="space-y-4 lg:col-span-3">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
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
              {/* Energy card — today's consumption */}
              <div className="rounded-xl border border-border bg-bg-card p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
                    Energy Today
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-2xl font-semibold text-text">
                    {live?.energy?.todayKwh?.toFixed(2) ?? "--"}
                  </span>
                  <span className="text-xs text-text-dim">kWh</span>
                </div>
                <p className="mt-0.5 text-[10px] text-text-dim">
                  {live?.energy?.todayCostKr?.toFixed(1) ?? "--"} kr
                </p>
              </div>
            </div>

            <EnvironmentChart zoneId={selectedZoneId} />
            <EnergyChart zoneId={selectedZoneId} />
            <ActiveBatchCard batch={live?.activeBatch ?? null} />
          </div>

          {/* Right column - 2/5 */}
          <div className="space-y-4 lg:col-span-2">
            <CameraFeed photo={live?.latestPhoto ?? null} />
            <AIDecisionFeed decisions={live?.recentDecisions ?? []} />
            <DeviceControl
              devices={live?.devices ?? []}
              zoneId={selectedZoneId}
              autoMode={live?.agent?.autoMode ?? true}
            />
          </div>
        </div>
      )}
    </div>
  );
}
