"""
AgriVision v14 — Example Integration

Shows how to use AgriVisionSync and MLInference together in the
existing mushroom_farm_agent_v13.py pipeline.
"""

import os

import numpy as np

from api_sync import AgriVisionSync
from ml_inference import MLInference

# Initialize from environment variables
sync = AgriVisionSync(
    api_url=os.getenv("API_URL", "http://localhost:3005"),
    api_key=os.getenv("API_KEY", "agv_demo1234567890abcdefghijklmnopqrstuvwxyz0123456789ab"),
    zone_id=os.getenv("ZONE_ID", "your-zone-id"),
)

ml = MLInference(models_dir=os.getenv("MODELS_DIR", "./models"))
ml.load_models()

# ── Example: Sensor read → push to cloud ────────────────────
sync.push_sensor(temperature=18.4, humidity=87.2, co2=680, vpd=0.44)

# ── Example: Capture frame → ML analysis → push results ────
# In production, capture from RealSense D435
rgb_frame = np.random.randint(0, 255, (720, 1280, 3), dtype=np.uint8)
depth_frame = np.random.randint(0, 65535, (720, 1280), dtype=np.uint16)

analysis = ml.run_full_analysis(rgb_frame, depth_frame)
sync.push_vision(batch_id="your-batch-id", analysis=analysis)

# ── Example: Upload photo to cloud ──────────────────────────
# sync.push_photo(rgb_path="/tmp/latest_rgb.jpg", depth_path="/tmp/latest_depth.png", analysis=analysis)

# ── Example: Poll and execute commands ──────────────────────
commands = sync.poll_commands()
for cmd in commands:
    print(f"Command: {cmd['command']} (ID: {cmd['id']})")

    if cmd["command"] == "START_FRUITING":
        # Execute: change phase, adjust humidity targets, etc.
        sync.ack_command(cmd["id"], status="EXECUTED", result="Phase changed to FRUITING")

    elif cmd["command"] == "FORCE_MIST":
        duration = cmd.get("payload", {}).get("duration_seconds", 300)
        # Execute: activate humidifier for duration
        sync.ack_command(cmd["id"], status="EXECUTED", result=f"Mist for {duration}s")

    else:
        sync.ack_command(cmd["id"], status="FAILED", result=f"Unknown command: {cmd['command']}")

# ── Example: Check for model updates ────────────────────────
models = sync.check_models(crop_type="oyster")
for m in models:
    print(f"Model: {m['name']} v{m['version']} ({m['fileSizeMb']} MB)")
