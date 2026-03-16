from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from ai.models.rubric_mlp import MLPConfig, RubricMLP


def _load_arrays(feature_dir: Path, task: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    X_train = np.load(feature_dir / "X_train.npy")
    X_val = np.load(feature_dir / "X_val.npy")
    X_test = np.load(feature_dir / "X_test.npy")

    if task == "ai_detect":
        y_train = np.load(feature_dir / "y_ai_train.npy").reshape(-1, 1)
        y_val = np.load(feature_dir / "y_ai_val.npy").reshape(-1, 1)
        y_test = np.load(feature_dir / "y_ai_test.npy").reshape(-1, 1)
    else:
        y_train = np.load(feature_dir / "Y_rubric_train.npy")
        y_val = np.load(feature_dir / "Y_rubric_val.npy")
        y_test = np.load(feature_dir / "Y_rubric_test.npy")

    return X_train, X_val, X_test, y_train, y_val, y_test


def _run_epoch(model: nn.Module, loader: DataLoader, loss_fn: nn.Module, optimizer: torch.optim.Optimizer | None = None) -> float:
    training = optimizer is not None
    model.train(training)
    total_loss = 0.0
    total_count = 0

    for xb, yb in loader:
        if training:
            optimizer.zero_grad()

        preds = model(xb)
        loss = loss_fn(preds, yb)

        if training:
            loss.backward()
            optimizer.step()

        total_loss += float(loss.item()) * len(xb)
        total_count += len(xb)

    return total_loss / max(total_count, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train MLP for AI detection or rubric score prediction")
    parser.add_argument("--task", choices=["ai_detect", "rubric"], required=True)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch_size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight_decay", type=float, default=1e-4)
    parser.add_argument("--patience", type=int, default=10)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    feature_dir = root / "data" / "features"
    output_dir = root / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    X_train, X_val, _, y_train, y_val, _ = _load_arrays(feature_dir, args.task)

    X_train_t = torch.tensor(X_train, dtype=torch.float32)
    y_train_t = torch.tensor(y_train, dtype=torch.float32)
    X_val_t = torch.tensor(X_val, dtype=torch.float32)
    y_val_t = torch.tensor(y_val, dtype=torch.float32)

    train_loader = DataLoader(TensorDataset(X_train_t, y_train_t), batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(TensorDataset(X_val_t, y_val_t), batch_size=args.batch_size)

    output_dim = y_train.shape[1]
    config = MLPConfig(input_dim=X_train.shape[1], output_dim=output_dim)
    model = RubricMLP(config)

    if args.task == "ai_detect":
        loss_fn: nn.Module = nn.BCEWithLogitsLoss()
    else:
        loss_fn = nn.SmoothL1Loss()

    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    best_val = float("inf")
    best_state = None
    patience_counter = 0

    history: list[dict[str, float]] = []
    for epoch in range(1, args.epochs + 1):
        train_loss = _run_epoch(model, train_loader, loss_fn, optimizer)
        with torch.no_grad():
            val_loss = _run_epoch(model, val_loader, loss_fn)

        history.append({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss})
        print(f"Epoch {epoch:03d} | train_loss={train_loss:.4f} | val_loss={val_loss:.4f}")

        if val_loss < best_val:
            best_val = val_loss
            best_state = model.state_dict()
            patience_counter = 0
        else:
            patience_counter += 1

        if patience_counter >= args.patience:
            print("Early stopping triggered.")
            break

    if best_state is None:
        raise RuntimeError("Training did not produce a valid model state.")

    model_path = output_dir / f"best_{args.task}.pth"
    torch.save(
        {
            "state_dict": best_state,
            "config": asdict(config),
            "task": args.task,
        },
        model_path,
    )

    history_path = output_dir / f"train_history_{args.task}.json"
    history_path.write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"Saved best model to {model_path}")


if __name__ == "__main__":
    main()
