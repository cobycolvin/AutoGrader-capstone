"""
Trains a binary XGBoost classifier: human (0) vs AI (1).
Supports per-language models or a combined model.

Usage:
    python training/train.py --lang python
    python training/train.py --lang java
    python training/train.py --lang all
"""

import argparse
import json
import pickle
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

sys.path.insert(0, str(Path(__file__).parent.parent))
from features.extractor import extract_dict, CodeFeatures

RAW_HUMAN = Path(__file__).parent.parent / "data" / "raw" / "human"
RAW_AI = Path(__file__).parent.parent / "data" / "raw" / "ai"
ARTIFACTS = Path(__file__).parent.parent / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


def load_jsonl(path: Path) -> list[dict]:
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def build_dataset(lang: str) -> pd.DataFrame:
    langs = ["python", "java"] if lang == "all" else [lang]
    rows = []

    for lg in langs:
        human_path = RAW_HUMAN / f"{lg}.jsonl"
        ai_path = RAW_AI / f"{lg}.jsonl"

        if not human_path.exists():
            raise SystemExit(f"Missing {human_path}. Run fetch_codesearchnet.py first.")
        if not ai_path.exists():
            raise SystemExit(f"Missing {ai_path}. Run generate_ai_samples.py first.")

        for rec in load_jsonl(human_path):
            feats = extract_dict(rec["code"], lg)
            feats["label"] = 0
            feats["language"] = lg
            rows.append(feats)

        for rec in load_jsonl(ai_path):
            feats = extract_dict(rec["code"], lg)
            feats["label"] = 1
            feats["language"] = lg
            rows.append(feats)

    df = pd.DataFrame(rows)
    df = df.fillna(0)
    return df


def train(lang: str, artifact_version: str) -> None:
    print(f"\nBuilding dataset for: {lang}")
    df = build_dataset(lang)

    print(f"Total samples: {len(df)}  "
          f"(human={len(df[df.label==0])}, ai={len(df[df.label==1])})")

    feature_cols = CodeFeatures.feature_names()
    X = df[feature_cols].values
    y = df["label"].values

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", XGBClassifier(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            use_label_encoder=False,
            eval_metric="logloss",
            random_state=42,
            n_jobs=-1,
        )),
    ])

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_validate(
        model, X, y, cv=cv,
        scoring=["roc_auc", "f1", "precision", "recall"],
        return_train_score=False,
    )

    print("\n── Cross-validation results ──")
    for metric in ["test_roc_auc", "test_f1", "test_precision", "test_recall"]:
        vals = scores[metric]
        print(f"  {metric[5:]:12s}  {np.mean(vals):.4f} ± {np.std(vals):.4f}")

    # Train on full dataset for production artifact
    print("\nTraining final model on full dataset...")
    model.fit(X, y)

    out_path = ARTIFACTS / f"model_{lang}.pkl"
    with open(out_path, "wb") as f:
        pickle.dump({
            "model": model,
            "feature_names": feature_cols,
            "lang": lang,
            "artifact_version": artifact_version,
            "trained_at_utc": datetime.now(timezone.utc).isoformat(),
            "n_human": int((y == 0).sum()),
            "n_ai": int((y == 1).sum()),
            "cv_auc": float(np.mean(scores["test_roc_auc"])),
        }, f)

    print(f"\nModel saved → {out_path}")
    print(f"Artifact version: {artifact_version}")
    print(f"CV AUC: {np.mean(scores['test_roc_auc']):.4f}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["python", "java", "all"], default="all")
    parser.add_argument(
        "--version",
        default='',
        help="Optional artifact version label to store in the trained model metadata.",
    )
    args = parser.parse_args()
    artifact_version = args.version.strip() or datetime.now(timezone.utc).strftime('xgboost-%Y%m%dT%H%M%SZ')

    if args.lang == "all":
        train("python", artifact_version)
        train("java", artifact_version)
        train("all", artifact_version)
    else:
        train(args.lang, artifact_version)


if __name__ == "__main__":
    main()
