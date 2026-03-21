"""
AgriVision Cloud API Sync Module — v14

Handles all HTTP communication between the Raspberry Pi agent and the
AgriVision cloud platform. Drop-in module for mushroom_farm_agent_v13.py.

Usage:
    from api_sync import AgriVisionSync
    sync = AgriVisionSync(
        api_url="https://your-app.vercel.app",
        api_key="agv_...",
        zone_id="clxyz..."
    )
    sync.push_sensor(temperature=18.4, humidity=87.2, co2=680)
"""

import logging
import time
from typing import Any, Optional

import requests

logger = logging.getLogger("agrivision.sync")

DEFAULT_TIMEOUT = 15  # seconds
MAX_RETRIES = 1


class AgriVisionSync:
    """Synchronizes local agent data with the AgriVision cloud platform."""

    def __init__(self, api_url: str, api_key: str, zone_id: str):
        self.api_url = api_url.rstrip("/")
        self.zone_id = zone_id
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {api_key}",
                "User-Agent": "AgriVision-Agent/14",
            }
        )

    def _request(
        self,
        method: str,
        path: str,
        json: Optional[dict] = None,
        files: Optional[dict] = None,
        data: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> Optional[dict]:
        """Make an HTTP request with retry logic."""
        url = f"{self.api_url}{path}"

        for attempt in range(MAX_RETRIES + 1):
            try:
                resp = self.session.request(
                    method,
                    url,
                    json=json,
                    files=files,
                    data=data,
                    params=params,
                    timeout=DEFAULT_TIMEOUT,
                )

                if resp.status_code >= 400:
                    logger.warning(
                        "API %s %s returned %d: %s",
                        method,
                        path,
                        resp.status_code,
                        resp.text[:200],
                    )
                    return None

                return resp.json() if resp.text else {}

            except requests.exceptions.Timeout:
                if attempt < MAX_RETRIES:
                    logger.warning(
                        "Timeout on %s %s, retrying (%d/%d)...",
                        method,
                        path,
                        attempt + 1,
                        MAX_RETRIES,
                    )
                    time.sleep(2)
                else:
                    logger.error("Timeout on %s %s after %d retries", method, path, MAX_RETRIES)
            except requests.exceptions.RequestException as e:
                logger.error("Request failed %s %s: %s", method, path, e)
                return None

        return None

    # ── Sensor Data ──────────────────────────────────────────────

    def push_sensor(
        self,
        temperature: float,
        humidity: float,
        co2: Optional[int] = None,
        vpd: Optional[float] = None,
        battery: Optional[int] = None,
    ) -> Optional[str]:
        """Push a sensor reading to the cloud. Returns reading ID or None."""
        payload: dict[str, Any] = {
            "zoneId": self.zone_id,
            "temperature": temperature,
            "humidity": humidity,
        }
        if co2 is not None:
            payload["co2"] = co2
        if vpd is not None:
            payload["vpd"] = vpd
        if battery is not None:
            payload["battery"] = battery

        result = self._request("POST", "/api/agent/sensor", json=payload)
        if result:
            logger.info("Sensor pushed: %.1f°C, %.0f%% RH", temperature, humidity)
            return result.get("id")
        return None

    # ── ML Vision Results ────────────────────────────────────────

    def push_vision(self, batch_id: str, analysis: dict) -> Optional[str]:
        """Push ML inference results. Returns photo analysis ID or None."""
        result = self._request(
            "POST",
            "/api/agent/vision",
            json={
                "zoneId": self.zone_id,
                "batchId": batch_id,
                "analysis": analysis,
            },
        )
        if result:
            logger.info("Vision results pushed for batch %s", batch_id)
            return result.get("id")
        return None

    # ── AI Decisions ─────────────────────────────────────────────

    def push_decision(
        self,
        decision_type: str,
        decision: str,
        reasoning: str,
        batch_id: Optional[str] = None,
        action_taken: Optional[str] = None,
        sensor_context: Optional[dict] = None,
        ml_context: Optional[dict] = None,
        cost_kr: Optional[float] = None,
    ) -> Optional[str]:
        """Push an AI decision. Returns decision ID or None."""
        payload: dict[str, Any] = {
            "decisionType": decision_type,
            "decision": decision,
            "reasoning": reasoning,
        }
        if batch_id:
            payload["batchId"] = batch_id
        if action_taken:
            payload["actionTaken"] = action_taken
        if sensor_context:
            payload["sensorContext"] = sensor_context
        if ml_context:
            payload["mlContext"] = ml_context
        if cost_kr is not None:
            payload["costKr"] = cost_kr

        result = self._request("POST", "/api/agent/decision", json=payload)
        if result:
            logger.info("Decision pushed: %s — %s", decision_type, decision)
            return result.get("id")
        return None

    # ── Device State ───────────────────────────────────────────

    def push_device_state(
        self,
        device_type: str,
        device_name: str,
        state: bool,
    ) -> Optional[str]:
        """Push a device state change. Returns device state ID or None."""
        result = self._request(
            "POST",
            "/api/agent/device-state",
            json={
                "zoneId": self.zone_id,
                "deviceType": device_type,
                "deviceName": device_name,
                "state": state,
            },
        )
        if result:
            logger.info("Device state pushed: %s %s → %s", device_type, device_name, "ON" if state else "OFF")
            return result.get("id")
        return None

    # ── Photo Upload ─────────────────────────────────────────────

    def push_photo(
        self,
        rgb_path: str,
        depth_path: Optional[str] = None,
        analysis: Optional[dict] = None,
    ) -> Optional[str]:
        """Upload a photo to the cloud via multipart form. Returns photo ID."""
        import json as json_mod

        files: dict[str, Any] = {
            "rgb": ("rgb.jpg", open(rgb_path, "rb"), "image/jpeg"),
        }
        data: dict[str, str] = {"zoneId": self.zone_id}

        if depth_path:
            files["depth"] = ("depth.png", open(depth_path, "rb"), "image/png")
        if analysis:
            data["analysis"] = json_mod.dumps(analysis)

        result = self._request("POST", "/api/agent/photo", files=files, data=data)

        # Close file handles
        for f in files.values():
            if hasattr(f[1], "close"):
                f[1].close()

        if result:
            logger.info("Photo uploaded: %s", rgb_path)
            return result.get("id")
        return None

    # ── Command Polling ──────────────────────────────────────────

    def poll_commands(self) -> list[dict]:
        """Poll for pending commands. Returns list of command dicts."""
        result = self._request(
            "GET",
            "/api/agent/commands",
            params={"zoneId": self.zone_id},
        )
        commands = result.get("commands", []) if result else []
        if commands:
            logger.info("Received %d pending command(s)", len(commands))
        return commands

    def ack_command(
        self,
        command_id: str,
        status: str = "EXECUTED",
        result: Optional[str] = None,
    ) -> bool:
        """Acknowledge a command execution. Returns True on success."""
        payload: dict[str, str] = {"status": status}
        if result:
            payload["result"] = result

        resp = self._request("PATCH", f"/api/agent/commands/{command_id}", json=payload)
        if resp:
            logger.info("Command %s acknowledged: %s", command_id, status)
            return True
        return False

    # ── Model Updates ────────────────────────────────────────────

    def check_models(self, crop_type: str = "oyster") -> list[dict]:
        """Check for available ML model updates. Returns list of model info."""
        result = self._request(
            "GET",
            "/api/agent/models",
            params={"cropType": crop_type},
        )
        models = result.get("models", []) if result else []
        if models:
            logger.debug("Available models: %s", [m["name"] for m in models])
        return models
