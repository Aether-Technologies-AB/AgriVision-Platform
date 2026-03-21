"""
AgriVision ML Inference Module — v14

Runs ONNX models locally on the Raspberry Pi for real-time crop analysis.
Models are placeholder — replace .onnx files with fine-tuned models from
the training pipeline.

Usage:
    from ml_inference import MLInference
    ml = MLInference(models_dir="./models")
    ml.load_models()
    results = ml.run_full_analysis(rgb_frame, depth_frame)
"""

import logging
import os
from pathlib import Path
from typing import Any, Optional

import numpy as np

logger = logging.getLogger("agrivision.ml")

try:
    import onnxruntime as ort

    ONNX_AVAILABLE = True
except ImportError:
    ONNX_AVAILABLE = False
    logger.warning("onnxruntime not installed — ML inference disabled")


def preprocess_frame(
    frame: np.ndarray,
    target_size: tuple[int, int] = (224, 224),
    bgr_to_rgb: bool = True,
) -> np.ndarray:
    """Preprocess a camera frame for model input.

    Args:
        frame: HxWxC uint8 numpy array (BGR or RGB)
        target_size: (width, height) for resize
        bgr_to_rgb: If True, convert BGR to RGB

    Returns:
        1xCxHxW float32 tensor normalized to [0, 1]
    """
    import cv2

    if bgr_to_rgb and frame.shape[2] == 3:
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    resized = cv2.resize(frame, target_size, interpolation=cv2.INTER_LINEAR)

    # Normalize to 0-1, convert to float32, transpose to CHW
    tensor = resized.astype(np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))  # HWC -> CHW
    tensor = np.expand_dims(tensor, axis=0)  # Add batch dim

    return tensor


class MLInference:
    """Runs ONNX models for crop analysis on captured frames."""

    def __init__(self, models_dir: str = "./models"):
        self.models_dir = Path(models_dir)
        self.sessions: dict[str, ort.InferenceSession] = {} if ONNX_AVAILABLE else {}

    def load_models(self) -> None:
        """Scan models directory and load all .onnx files."""
        if not ONNX_AVAILABLE:
            logger.error("Cannot load models: onnxruntime not installed")
            return

        if not self.models_dir.exists():
            logger.warning("Models directory not found: %s", self.models_dir)
            os.makedirs(self.models_dir, exist_ok=True)
            return

        for onnx_file in self.models_dir.glob("*.onnx"):
            model_name = onnx_file.stem  # e.g., "contamination_detector"
            try:
                session = ort.InferenceSession(
                    str(onnx_file),
                    providers=["CPUExecutionProvider"],
                )
                self.sessions[model_name] = session
                logger.info("Loaded model: %s (%s)", model_name, onnx_file.name)
            except Exception as e:
                logger.error("Failed to load model %s: %s", model_name, e)

        logger.info("Loaded %d model(s) from %s", len(self.sessions), self.models_dir)

    def _run_model(self, model_name: str, input_tensor: np.ndarray) -> Optional[np.ndarray]:
        """Run a single model. Returns output array or None if model unavailable."""
        session = self.sessions.get(model_name)
        if not session:
            logger.debug("Model '%s' not loaded, skipping", model_name)
            return None

        try:
            input_name = session.get_inputs()[0].name
            outputs = session.run(None, {input_name: input_tensor})
            return outputs[0]
        except Exception as e:
            logger.error("Inference error on %s: %s", model_name, e)
            return None

    # ── Individual Model Runners ─────────────────────────────────

    def run_contamination(self, rgb_frame: np.ndarray) -> dict[str, Any]:
        """Detect contamination in the crop image.

        Returns:
            { contamination_risk: float 0-1, contamination_type: str|None }
        """
        tensor = preprocess_frame(rgb_frame)
        output = self._run_model("contamination_detector", tensor)

        if output is None:
            return {"contamination_risk": 0.0, "contamination_type": None}

        # Assume output is [1, num_classes] softmax probabilities
        # Class 0 = clean, Class 1+ = contamination types
        probs = output[0]
        risk = float(1.0 - probs[0]) if len(probs) > 1 else 0.0

        contamination_types = ["trichoderma", "cobweb", "bacterial", "unknown"]
        contam_type = None
        if risk > 0.3 and len(probs) > 1:
            top_class = int(np.argmax(probs[1:])) if len(probs) > 2 else 0
            contam_type = contamination_types[min(top_class, len(contamination_types) - 1)]

        return {"contamination_risk": round(risk, 3), "contamination_type": contam_type}

    def run_growth_stage(self, rgb_frame: np.ndarray) -> dict[str, Any]:
        """Classify growth stage and count pins.

        Returns:
            { stage: str, coverage_percent: float, pin_count: int }
        """
        tensor = preprocess_frame(rgb_frame)
        output = self._run_model("growth_stage_classifier", tensor)

        if output is None:
            return {"stage": "unknown", "coverage_percent": 0.0, "pin_count": 0}

        stages = ["primordial", "pinning", "developing", "mature", "overmature"]
        probs = output[0]
        stage_idx = int(np.argmax(probs))
        stage = stages[min(stage_idx, len(stages) - 1)]

        # Estimate coverage from stage confidence
        coverage = float(probs[stage_idx]) * 100

        # Pin count would come from a separate detection model in production
        pin_count = max(0, int(np.sum(probs[1:3] * 10)))

        return {
            "stage": stage,
            "coverage_percent": round(coverage, 1),
            "pin_count": pin_count,
        }

    def run_weight_prediction(
        self, rgb_frame: np.ndarray, depth_frame: Optional[np.ndarray] = None
    ) -> dict[str, Any]:
        """Predict mushroom cluster weight using RGB and optional depth data.

        Returns:
            { estimated_weight_g: float, confidence: float }
        """
        tensor = preprocess_frame(rgb_frame)

        # If depth available, concatenate as 4th channel
        if depth_frame is not None:
            try:
                import cv2

                depth_resized = cv2.resize(depth_frame, (224, 224))
                if len(depth_resized.shape) == 2:
                    depth_resized = depth_resized[:, :, np.newaxis]
                depth_norm = depth_resized.astype(np.float32) / 65535.0  # 16-bit depth
                depth_channel = np.transpose(depth_norm, (2, 0, 1))
                depth_channel = np.expand_dims(depth_channel, axis=0)
                tensor = np.concatenate([tensor, depth_channel], axis=1)
            except Exception as e:
                logger.debug("Depth preprocessing failed: %s", e)

        output = self._run_model("weight_predictor", tensor)

        if output is None:
            return {"estimated_weight_g": 0.0, "confidence": 0.0}

        weight_g = float(np.clip(output[0][0], 0, 5000))
        confidence = float(np.clip(output[0][1], 0, 1)) if output[0].size > 1 else 0.5

        return {
            "estimated_weight_g": round(weight_g, 1),
            "confidence": round(confidence, 3),
        }

    # ── Combined Analysis ────────────────────────────────────────

    def run_full_analysis(
        self, rgb_frame: np.ndarray, depth_frame: Optional[np.ndarray] = None
    ) -> dict[str, Any]:
        """Run all available models and return combined results.

        Returns combined dict with all model outputs plus metadata.
        """
        results: dict[str, Any] = {}

        # Run each model, skip if unavailable
        contam = self.run_contamination(rgb_frame)
        results.update(contam)

        growth = self.run_growth_stage(rgb_frame)
        results.update(growth)

        weight = self.run_weight_prediction(rgb_frame, depth_frame)
        results.update(weight)

        # Add metadata
        results["models_loaded"] = list(self.sessions.keys())
        results["models_run"] = len(
            [k for k in ["contamination_detector", "growth_stage_classifier", "weight_predictor"] if k in self.sessions]
        )

        logger.info(
            "Full analysis: weight=%.0fg, contam=%.2f, stage=%s",
            results.get("estimated_weight_g", 0),
            results.get("contamination_risk", 0),
            results.get("stage", "?"),
        )

        return results
