"""Entry point for M5 fine-tune."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.config import TrainConfig  # noqa: E402
from src.train.fine_tune import run  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="configs/fine_tune.yaml")
    args = parser.parse_args()

    cfg = TrainConfig()
    cfg_path = ROOT / args.config
    if cfg_path.exists():
        with open(cfg_path) as f:
            overrides = yaml.safe_load(f) or {}
        for k, v in overrides.items():
            if hasattr(cfg, k):
                setattr(cfg, k, v)
    run(cfg)


if __name__ == "__main__":
    main()
