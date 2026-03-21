# AgriVision Pi Agent v14 — Cloud Sync Module

This module adds cloud API integration and local ML inference to the existing `mushroom_farm_agent_v13.py`.

## Setup

```bash
# On the Raspberry Pi
pip install requests onnxruntime opencv-python-headless

# Create .env file
cat > .env << 'EOF'
API_URL=https://your-app.vercel.app
API_KEY=agv_your_api_key_here
ZONE_ID=your_zone_id_from_dashboard
MODELS_DIR=./models
BATCH_ID=current_batch_id
EOF
```

## Files

| File | Purpose |
|------|---------|
| `api_sync.py` | HTTP client for all cloud API communication |
| `ml_inference.py` | ONNX model runner for local ML inference |
| `example_integration.py` | Quick-start example showing the integration pattern |

## Integration with v13 Agent

Add these imports to `mushroom_farm_agent_v13.py`:

```python
from api_sync import AgriVisionSync
from ml_inference import MLInference

sync = AgriVisionSync(
    api_url=os.getenv("API_URL"),
    api_key=os.getenv("API_KEY"),
    zone_id=os.getenv("ZONE_ID"),
)

ml = MLInference(models_dir=os.getenv("MODELS_DIR", "./models"))
ml.load_models()
```

### Where to add sync calls:

**1. After each sensor read in `task_sensor_control()`:**
```python
async def task_sensor_control():
    while True:
        temp, humidity, co2, vpd = read_sensors()

        # Existing: rule-based control
        control_humidity(humidity)
        control_fan(co2)

        # NEW: push to cloud
        sync.push_sensor(
            temperature=temp,
            humidity=humidity,
            co2=co2,
            vpd=vpd,
            battery=get_battery_level(),
        )

        await asyncio.sleep(300)  # Every 5 min
```

**2. After each vision check in `task_vision()`:**
```python
async def task_vision():
    while True:
        rgb, depth = capture_realsense()

        # NEW: local ML inference (replaces Claude API vision)
        analysis = ml.run_full_analysis(rgb, depth)
        sync.push_vision(batch_id=BATCH_ID, analysis=analysis)

        # Still use Claude for strategic decisions, but with ML data
        if analysis["contamination_risk"] > 0.3:
            sync.push_decision(
                decision_type="ALERT",
                decision="CONTAMINATION_DETECTED",
                reasoning=f"Contamination risk {analysis['contamination_risk']:.0%}",
                batch_id=BATCH_ID,
                ml_context=analysis,
            )

        await asyncio.sleep(4 * 3600)  # Every 4 hours
```

**3. After each photo capture in `task_photos()`:**
```python
async def task_photos():
    while True:
        rgb_path, depth_path = capture_and_save()

        # NEW: upload to cloud (replaces Google Drive)
        sync.push_photo(
            rgb_path=rgb_path,
            depth_path=depth_path,
            analysis=ml.run_full_analysis(
                cv2.imread(rgb_path),
                cv2.imread(depth_path, cv2.IMREAD_UNCHANGED),
            ),
        )

        await asyncio.sleep(6 * 3600)  # Every 6 hours
```

**4. Command polling in the main loop:**
```python
async def task_commands():
    """Poll cloud for commands (replaces Telegram as primary control)."""
    while True:
        commands = sync.poll_commands()
        for cmd in commands:
            result = execute_command(cmd["command"], cmd.get("payload"))
            sync.ack_command(
                cmd["id"],
                status="EXECUTED" if result else "FAILED",
                result=str(result),
            )
        await asyncio.sleep(30)  # Every 30 seconds
```

## ML Models

Place `.onnx` model files in the `models/` directory:

```
models/
├── contamination_detector.onnx    # Detects mold/contamination
├── growth_stage_classifier.onnx   # Classifies growth phase
└── weight_predictor.onnx          # Estimates cluster weight (RGB+D)
```

Models are fine-tuned from ImageNet in the training pipeline (see `/training/` directory). Export as ONNX with INT8 quantization for Pi inference.

If a model file is missing, that analysis step is skipped gracefully — the agent continues with available models.

## Architecture

```
Pi Agent v14
├── task_sensor_control()  → sync.push_sensor()      → POST /api/agent/sensor
├── task_vision()          → ml.run_full_analysis()
│                          → sync.push_vision()       → POST /api/agent/vision
│                          → sync.push_decision()     → POST /api/agent/decision
├── task_photos()          → sync.push_photo()        → POST /api/agent/photo
├── task_commands()        → sync.poll_commands()      → GET  /api/agent/commands
│                          → sync.ack_command()        → PATCH /api/agent/commands/:id
└── on_startup()           → sync.check_models()      → GET  /api/agent/models
```

Telegram and Google Sheets remain as fallback channels. The cloud API is the primary data destination.
