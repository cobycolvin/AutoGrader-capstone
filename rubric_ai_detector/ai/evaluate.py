from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import (
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    precision_score,
    recall_score,
    roc_auc_score,
)

from ai.models.rubric_mlp import MLPConfig, RubricMLP


def _load_rubric_column_names(feature_dir: Path) -> list[str]:
    path = feature_dir / "rubric_column_names.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _load_model(model_path: Path) -> RubricMLP:
    payload = torch.load(model_path, map_location="cpu")
    config = MLPConfig(**payload["config"])
    model = RubricMLP(config)
    model.load_state_dict(payload["state_dict"])
    model.eval()
    return model


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate AI detector or rubric model")
    parser.add_argument("--task", choices=["ai_detect", "rubric"], required=True)
    parser.add_argument("--threshold", type=float, default=0.85)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    feature_dir = root / "data" / "features"
    output_dir = root / "output"

    X_test = np.load(feature_dir / "X_test.npy")
    y_ai_test = np.load(feature_dir / "y_ai_test.npy")

    model = _load_model(output_dir / f"best_{args.task}.pth")
    with torch.no_grad():
        preds = model(torch.tensor(X_test, dtype=torch.float32)).numpy()

    results: dict[str, object]
    if args.task == "ai_detect":
        probs = 1.0 / (1.0 + np.exp(-preds.reshape(-1)))
        labels = (probs >= args.threshold).astype(int)
        results = {
            "task": "ai_detect",
            "threshold": args.threshold,
            "roc_auc": float(roc_auc_score(y_ai_test, probs)) if len(np.unique(y_ai_test)) > 1 else None,
            "confusion_matrix": confusion_matrix(y_ai_test, labels).tolist(),
            "precision": float(precision_score(y_ai_test, labels, zero_division=0)),
            "recall": float(recall_score(y_ai_test, labels, zero_division=0)),
            "f1": float(f1_score(y_ai_test, labels, zero_division=0)),
        }
    else:
        y_rubric_test = np.load(feature_dir / "Y_rubric_test.npy")
        rubric_column_names = _load_rubric_column_names(feature_dir)
        mae_per_dim = []
        for idx in range(y_rubric_test.shape[1]):
            mae_per_dim.append(float(mean_absolute_error(y_rubric_test[:, idx], preds[:, idx])))

        results = {
            "task": "rubric",
            "overall_mae": float(mean_absolute_error(y_rubric_test, preds)),
            "mae_by_dimension": {
                rubric_column_names[i] if i < len(rubric_column_names) else f"dim_{i}": mae
                for i, mae in enumerate(mae_per_dim)
            },
        }

    out_path = output_dir / f"evaluation_{args.task}.json"
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
