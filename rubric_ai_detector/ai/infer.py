from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import torch

from ai.features.extract_features import extract_features_from_file
from ai.models.rubric_mlp import MLPConfig, RubricMLP


def _load_model(output_dir: Path, task: str) -> RubricMLP:
    payload = torch.load(output_dir / f"best_{task}.pth", map_location="cpu")
    model = RubricMLP(MLPConfig(**payload["config"]))
    model.load_state_dict(payload["state_dict"])
    model.eval()
    return model


def main() -> None:
    parser = argparse.ArgumentParser(description="Run inference for one Python file")
    parser.add_argument("--task", choices=["ai_detect", "rubric"], required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--threshold", type=float, default=0.85)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    feature_dir = root / "data" / "features"
    output_dir = root / "output"

    scaler = joblib.load(feature_dir / "scaler.joblib")
    features = extract_features_from_file(args.file)
    X = scaler.transform(np.array(features.values, dtype=np.float32).reshape(1, -1))

    model = _load_model(output_dir, args.task)
    with torch.no_grad():
        raw_pred = model(torch.tensor(X, dtype=torch.float32)).numpy().reshape(-1)

    if args.task == "ai_detect":
        prob = float(1.0 / (1.0 + np.exp(-raw_pred[0])))
        output = {
            "file": args.file,
            "ai_generated_probability": prob,
            "flagged": prob >= args.threshold,
            "threshold": args.threshold,
        }
    else:
        output = {
            "file": args.file,
            "predicted_rubric_scores": [float(v) for v in raw_pred.tolist()],
        }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()