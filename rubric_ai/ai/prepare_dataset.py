from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from ai.features.extract_features import extract_features_from_file

RUBRIC_COLUMNS = ["readability_points", "design_points", "docs_points"]


@dataclass
class SampleRecord:
    sample_id: str
    source: str
    path: Path
    label_ai: int
    rubric_scores: list[float]


def _resolve_file_path(base_dir: Path, source: str, sample_id: str) -> Path:
    return base_dir / "raw" / source / f"{sample_id}.py"


def _load_labels(data_dir: Path) -> list[SampleRecord]:
    labels_path = data_dir / "labels.csv"
    df = pd.read_csv(labels_path)

    required_cols = {"sample_id", "source", "label_ai"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"labels.csv is missing required columns: {sorted(missing)}")

    records: list[SampleRecord] = []
    for row in df.to_dict(orient="records"):
        sample_id = str(row["sample_id"])
        source = str(row["source"]).strip().lower()
        if source not in {"human", "ai"}:
            raise ValueError(f"Unsupported source '{source}' for sample_id={sample_id}")

        path = _resolve_file_path(data_dir, source, sample_id)
        if not path.exists():
            raise FileNotFoundError(f"Missing source file for {sample_id}: {path}")

        rubric_scores: list[float] = []
        for col in RUBRIC_COLUMNS:
            value = row.get(col, np.nan)
            rubric_scores.append(float(value) if pd.notna(value) else np.nan)

        records.append(
            SampleRecord(
                sample_id=sample_id,
                source=source,
                path=path,
                label_ai=int(row["label_ai"]),
                rubric_scores=rubric_scores,
            )
        )
    return records


def _extract_matrix(records: list[SampleRecord]) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    features: list[list[float]] = []
    y_ai: list[int] = []
    y_rubric: list[list[float]] = []
    feature_names: list[str] = []

    for rec in records:
        result = extract_features_from_file(rec.path)
        if not feature_names:
            feature_names = result.feature_names
        features.append(result.values)
        y_ai.append(rec.label_ai)
        y_rubric.append(rec.rubric_scores)

    return np.array(features, dtype=np.float32), np.array(y_ai, dtype=np.float32), np.array(y_rubric, dtype=np.float32), feature_names


def _save_metadata(path: Path, records: list[SampleRecord]) -> None:
    meta = pd.DataFrame(
        {
            "sample_id": [r.sample_id for r in records],
            "source": [r.source for r in records],
            "path": [str(r.path) for r in records],
            "label_ai": [r.label_ai for r in records],
        }
    )
    meta.to_csv(path, index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare tabular feature dataset for model training.")
    parser.add_argument("--language", default="python", help="Only 'python' is currently supported.")
    parser.add_argument("--test_size", type=float, default=0.2)
    parser.add_argument("--val_size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.language.lower() != "python":
        raise ValueError("Only Python is supported in this starter project.")

    root = Path(__file__).resolve().parent
    data_dir = root / "data"
    split_dir = data_dir / "splits"
    feature_dir = data_dir / "features"
    split_dir.mkdir(parents=True, exist_ok=True)
    feature_dir.mkdir(parents=True, exist_ok=True)

    records = _load_labels(data_dir)
    X, y_ai, Y_rubric, feature_names = _extract_matrix(records)

    idx = np.arange(len(records))
    def safe_stratify(labels: np.ndarray, size: float, n_samples: int) -> np.ndarray | None:
        unique, counts = np.unique(labels, return_counts=True)
        if len(unique) < 2:
            return None
        split_count = max(1, int(round(n_samples * size)))
        if split_count < len(unique):
            return None
        if np.min(counts) < 2:
            return None
        return labels

    train_idx, test_idx = train_test_split(
        idx,
        test_size=args.test_size,
        random_state=args.seed,
        stratify=safe_stratify(y_ai, args.test_size, len(idx)),
    )

    train_idx, val_idx = train_test_split(
        train_idx,
        test_size=args.val_size,
        random_state=args.seed,
        stratify=safe_stratify(y_ai[train_idx], args.val_size, len(train_idx)),
    )

    scaler = StandardScaler()
    X_train = scaler.fit_transform(X[train_idx])
    X_val = scaler.transform(X[val_idx])
    X_test = scaler.transform(X[test_idx])

    np.save(feature_dir / "X_train.npy", X_train)
    np.save(feature_dir / "X_val.npy", X_val)
    np.save(feature_dir / "X_test.npy", X_test)

    np.save(feature_dir / "y_ai_train.npy", y_ai[train_idx])
    np.save(feature_dir / "y_ai_val.npy", y_ai[val_idx])
    np.save(feature_dir / "y_ai_test.npy", y_ai[test_idx])

    if not np.isnan(Y_rubric).all():
        np.save(feature_dir / "Y_rubric_train.npy", Y_rubric[train_idx])
        np.save(feature_dir / "Y_rubric_val.npy", Y_rubric[val_idx])
        np.save(feature_dir / "Y_rubric_test.npy", Y_rubric[test_idx])

    joblib.dump(scaler, feature_dir / "scaler.joblib")

    with (feature_dir / "feature_names.json").open("w", encoding="utf-8") as f:
        json.dump(feature_names, f, indent=2)

    record_list = list(records)
    _save_metadata(split_dir / "train_metadata.csv", [record_list[i] for i in train_idx])
    _save_metadata(split_dir / "val_metadata.csv", [record_list[i] for i in val_idx])
    _save_metadata(split_dir / "test_metadata.csv", [record_list[i] for i in test_idx])

    print(f"Prepared dataset with {len(records)} samples.")
    print(f"Train/Val/Test sizes: {len(train_idx)}/{len(val_idx)}/{len(test_idx)}")


if __name__ == "__main__":
    main()
