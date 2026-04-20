"""
Evaluates a trained model artifact on a held-out sample.
Prints AUC, F1, confusion matrix, and top feature importances.

Usage:
    python training/evaluate.py --model artifacts/model_python.pkl
"""

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    roc_auc_score, f1_score, precision_score,
    recall_score, confusion_matrix, classification_report,
)

sys.path.insert(0, str(Path(__file__).parent.parent))
from features.extractor import extract_dict

RAW_HUMAN = Path(__file__).parent.parent / "data" / "raw" / "human"
RAW_AI = Path(__file__).parent.parent / "data" / "raw" / "ai"


def load_jsonl(path: Path) -> list[dict]:
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--samples", type=int, default=200,
                        help="Samples per class for eval (default 200)")
    args = parser.parse_args()

    with open(args.model, "rb") as f:
        artifact = pickle.load(f)

    model = artifact["model"]
    feature_names = artifact["feature_names"]
    lang = artifact["lang"]
    artifact_version = artifact.get("artifact_version") or "unknown"

    langs = ["python", "java"] if lang == "all" else [lang]
    rows, labels = [], []

    for lg in langs:
        human = load_jsonl(RAW_HUMAN / f"{lg}.jsonl")[-args.samples:]
        ai = load_jsonl(RAW_AI / f"{lg}.jsonl")[-args.samples:]

        for rec in human:
            rows.append(extract_dict(rec["code"], lg))
            labels.append(0)
        for rec in ai:
            rows.append(extract_dict(rec["code"], lg))
            labels.append(1)

    df = pd.DataFrame(rows).fillna(0)
    X = df[feature_names].values
    y = np.array(labels)

    probs = model.predict_proba(X)[:, 1]
    preds = (probs >= 0.5).astype(int)

    print(f"\n── Evaluation: {lang} model ──")
    print(f"Artifact version: {artifact_version}")
    print(f"Samples: {len(y)} (human={sum(y==0)}, ai={sum(y==1)})")
    print(f"\nROC-AUC   : {roc_auc_score(y, probs):.4f}")
    print(f"F1        : {f1_score(y, preds):.4f}")
    print(f"Precision : {precision_score(y, preds):.4f}")
    print(f"Recall    : {recall_score(y, preds):.4f}")

    cm = confusion_matrix(y, preds)
    print(f"\nConfusion matrix (rows=actual, cols=predicted):")
    print(f"            Human  AI")
    print(f"  Human     {cm[0,0]:5d}  {cm[0,1]:5d}")
    print(f"  AI        {cm[1,0]:5d}  {cm[1,1]:5d}")

    print(f"\n{classification_report(y, preds, target_names=['human', 'ai'])}")

    # Feature importances (XGBoost step inside Pipeline)
    clf = model.named_steps["clf"]
    importances = clf.feature_importances_
    top_idx = np.argsort(importances)[::-1][:10]
    print("── Top 10 features ──")
    for i in top_idx:
        print(f"  {feature_names[i]:35s}  {importances[i]:.4f}")


if __name__ == "__main__":
    main()
