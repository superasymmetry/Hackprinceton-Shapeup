"""Entry point for M4 linear probe."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.config import TrainConfig  # noqa: E402
from src.train.linear_probe import run  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--lr", type=float, default=1e-2)
    args = parser.parse_args()
    run(TrainConfig(), epochs=args.epochs, lr=args.lr)


if __name__ == "__main__":
    main()
