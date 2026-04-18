"""Entry point for M2 dataset ingest. See src/preprocess/dataset_ingest.py."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.preprocess.dataset_ingest import ingest  # noqa: E402


if __name__ == "__main__":
    accepted, rejected = ingest()
    print(f"[ingest] accepted={accepted} rejected={rejected}")
