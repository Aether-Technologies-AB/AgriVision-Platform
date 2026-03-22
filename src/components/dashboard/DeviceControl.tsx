"use client";

import { useState } from "react";
import {
  Power,
  Droplets,
  Wind,
  Lightbulb,
  Flame,
  Waves,
  ToggleLeft,
  ToggleRight,
  Building2,
} from "lucide-react";

interface Device {
  id: string;
  type: string;
  name: string;
  state: boolean;
  lastToggled: string | null;
  scope?: "ZONE" | "FARM";
  zoneName?: string;
}

const deviceIcons: Record<string, React.ReactNode> = {
  HUMIDIFIER: <Droplets className="h-4 w-4" />,
  FAN: <Wind className="h-4 w-4" />,
  LIGHT: <Lightbulb className="h-4 w-4" />,
  HEATER: <Flame className="h-4 w-4" />,
  PUMP: <Waves className="h-4 w-4" />,
};

function DeviceRow({
  device,
  sending,
  disabled,
  onToggle,
}: {
  device: Device;
  sending: string | null;
  disabled: boolean;
  onToggle: (cmd: string) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className={device.state ? "text-green" : "text-text-dim"}>
          {deviceIcons[device.type] || <Power className="h-4 w-4" />}
        </span>
        <div>
          <p className="text-xs font-medium text-text">
            {device.name}
            {device.zoneName && (
              <span className="ml-1 text-[10px] text-text-dim">({device.zoneName})</span>
            )}
          </p>
          <p className="text-[10px] text-text-dim">
            {device.state ? "ON" : "OFF"}
            {device.lastToggled &&
              ` · ${new Date(device.lastToggled).toLocaleTimeString("sv-SE", {
                hour: "2-digit",
                minute: "2-digit",
              })}`}
          </p>
        </div>
      </div>
      <button
        onClick={() =>
          onToggle(`TOGGLE_${device.type}${device.state ? "_OFF" : "_ON"}`)
        }
        disabled={sending !== null || disabled}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
          device.state
            ? "bg-green/15 text-green hover:bg-green/25"
            : "bg-border text-text-dim hover:bg-border hover:text-text-mid"
        } disabled:opacity-40`}
      >
        {device.state ? "ON" : "OFF"}
      </button>
    </div>
  );
}

export default function DeviceControl({
  devices,
  zoneId,
  autoMode,
}: {
  devices: Device[];
  zoneId: string;
  autoMode: boolean;
}) {
  const [sending, setSending] = useState<string | null>(null);
  const [localAutoMode, setLocalAutoMode] = useState(autoMode);

  async function sendCommand(command: string) {
    setSending(command);
    try {
      await fetch(`/api/commands/${zoneId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
    } catch (err) {
      console.error("Failed to send command:", err);
    } finally {
      setSending(null);
    }
  }

  async function toggleAutoMode() {
    const cmd = localAutoMode ? "DISABLE_AUTO" : "ENABLE_AUTO";
    setLocalAutoMode(!localAutoMode);
    await sendCommand(cmd);
  }

  const farmDevices = devices.filter((d) => d.scope === "FARM");
  const zoneDevices = devices.filter((d) => d.scope !== "FARM");

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4 text-text-mid" />
          <span className="text-sm font-medium text-text">Devices</span>
        </div>
        <button onClick={toggleAutoMode} className="flex items-center gap-1.5 text-xs">
          {localAutoMode ? (
            <ToggleRight className="h-5 w-5 text-green" />
          ) : (
            <ToggleLeft className="h-5 w-5 text-text-dim" />
          )}
          <span className={localAutoMode ? "text-green" : "text-text-dim"}>
            {localAutoMode ? "Auto" : "Manual"}
          </span>
        </button>
      </div>

      <div className="space-y-2">
        {devices.length === 0 ? (
          <p className="py-2 text-center text-xs text-text-dim">No devices configured</p>
        ) : (
          <>
            {farmDevices.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 pt-1">
                  <Building2 className="h-3 w-3 text-text-dim" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
                    Farm-wide
                  </span>
                </div>
                {farmDevices.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    sending={sending}
                    disabled={localAutoMode}
                    onToggle={sendCommand}
                  />
                ))}
              </>
            )}
            {zoneDevices.length > 0 && (
              <>
                {farmDevices.length > 0 && (
                  <div className="flex items-center gap-1.5 pt-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
                      Zone
                    </span>
                  </div>
                )}
                {zoneDevices.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    sending={sending}
                    disabled={localAutoMode}
                    onToggle={sendCommand}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
