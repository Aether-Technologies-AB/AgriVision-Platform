"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Settings as SettingsIcon,
  MapPin,
  Key,
  Users,
  Bell,
  Brain,
} from "lucide-react";
import FarmSettings from "@/components/settings/FarmSettings";
import ZoneManager from "@/components/settings/ZoneManager";
import ApiKeyManager from "@/components/settings/ApiKeyManager";
import UserManager from "@/components/settings/UserManager";
import NotificationSettings from "@/components/settings/NotificationSettings";
import ModelRegistry from "@/components/settings/ModelRegistry";

type Tab = "farm" | "keys" | "users" | "notifications" | "models";

const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "farm", label: "Farm & Zones", icon: <MapPin className="h-4 w-4" /> },
  { key: "keys", label: "API Keys", icon: <Key className="h-4 w-4" /> },
  { key: "users", label: "Users", icon: <Users className="h-4 w-4" /> },
  { key: "notifications", label: "Notifications", icon: <Bell className="h-4 w-4" /> },
  { key: "models", label: "Models", icon: <Brain className="h-4 w-4" /> },
];

interface FarmData {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  zones: {
    id: string;
    name: string;
    cameraType: string | null;
    sensorUrl: string | null;
    plugIds: unknown;
    agentStatus: string;
    currentPhase: string;
    activeBatchCount: number;
  }[];
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("farm");
  const [farm, setFarm] = useState<FarmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState<{ id: string; role: string } | null>(null);

  const fetchFarm = useCallback(() => {
    fetch("/api/settings/farm")
      .then((r) => r.json())
      .then((d) => { setFarm(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchFarm();
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user) setSessionData({ id: d.user.id, role: d.user.role });
      });
  }, [fetchFarm]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-6 w-6 text-green" />
        <h1 className="text-2xl font-semibold text-text">Settings</h1>
      </div>

      <div className="flex gap-6">
        {/* Tab sidebar */}
        <div className="w-48 shrink-0 space-y-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "bg-green/10 text-green"
                  : "text-text-mid hover:bg-green/5 hover:text-text"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="rounded-xl border border-border bg-bg-card p-12 text-center text-sm text-text-dim">
              Loading settings...
            </div>
          ) : (
            <>
              {activeTab === "farm" && farm && (
                <div className="space-y-5">
                  <FarmSettings farm={farm} />
                  <ZoneManager zones={farm.zones} onRefresh={fetchFarm} />
                </div>
              )}
              {activeTab === "keys" && <ApiKeyManager />}
              {activeTab === "users" && sessionData && (
                <UserManager currentUserId={sessionData.id} currentUserRole={sessionData.role} />
              )}
              {activeTab === "notifications" && <NotificationSettings />}
              {activeTab === "models" && <ModelRegistry />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
