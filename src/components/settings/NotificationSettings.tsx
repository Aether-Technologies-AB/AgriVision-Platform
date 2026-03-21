"use client";

import { useState } from "react";
import { Bell, Mail, MessageCircle } from "lucide-react";

export default function NotificationSettings() {
  const [emailAlerts, setEmailAlerts] = useState(false);
  const [telegramAlerts, setTelegramAlerts] = useState(true);
  const [humidityThreshold, setHumidityThreshold] = useState(80);
  const [tempThreshold, setTempThreshold] = useState(25);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber" />
          <h3 className="text-sm font-medium text-text">Alert Channels</h3>
        </div>
        <p className="mb-4 text-xs text-text-dim">
          Notification settings coming soon. Currently, alerts are sent via Telegram from the Pi agent.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-text-dim" />
              <div>
                <p className="text-sm text-text">Email Alerts</p>
                <p className="text-[10px] text-text-dim">Receive alerts via email</p>
              </div>
            </div>
            <button
              onClick={() => setEmailAlerts(!emailAlerts)}
              className={`h-6 w-11 rounded-full transition-colors ${emailAlerts ? "bg-green" : "bg-border"}`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${emailAlerts ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-text-dim" />
              <div>
                <p className="text-sm text-text">Telegram Alerts</p>
                <p className="text-[10px] text-text-dim">Via Pi agent Telegram bot</p>
              </div>
            </div>
            <button
              onClick={() => setTelegramAlerts(!telegramAlerts)}
              className={`h-6 w-11 rounded-full transition-colors ${telegramAlerts ? "bg-green" : "bg-border"}`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${telegramAlerts ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg-card p-5">
        <h3 className="mb-3 text-sm font-medium text-text">Alert Thresholds</h3>
        <p className="mb-4 text-xs text-text-dim">
          Threshold configuration coming soon.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-mid">
              Alert if humidity drops below
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={humidityThreshold}
                onChange={(e) => setHumidityThreshold(Number(e.target.value))}
                className="w-20 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-text focus:border-green focus:outline-none"
              />
              <span className="text-sm text-text-dim">%</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-mid">
              Alert if temperature exceeds
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={tempThreshold}
                onChange={(e) => setTempThreshold(Number(e.target.value))}
                className="w-20 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-text focus:border-green focus:outline-none"
              />
              <span className="text-sm text-text-dim">&deg;C</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
