from __future__ import annotations

from dataclasses import dataclass

import torch
from torch import nn


@dataclass
class MLPConfig:
    input_dim: int
    output_dim: int
    hidden_dim_1: int = 128
    hidden_dim_2: int = 64
    dropout: float = 0.2


class RubricMLP(nn.Module):
    def __init__(self, config: MLPConfig) -> None:
        super().__init__()
        self.config = config
        self.network = nn.Sequential(
            nn.Linear(config.input_dim, config.hidden_dim_1),
            nn.ReLU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.hidden_dim_1, config.hidden_dim_2),
            nn.ReLU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.hidden_dim_2, config.output_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.network(x)
