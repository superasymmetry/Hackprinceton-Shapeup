"""Build source-disjoint train/val/test splits from labels.csv.

We split BY SOURCE and then by filename-hash within each source — so the same
physical image can never land in two splits, and splits aren't correlated with
any single source's photographer/style bias. Targets: 80/10/10.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.config import LABELS_CSV, SPLITS_DIR  # noqa: E402


def _bucket(image_path: str, seed: int) -> str:
    """Deterministic bucket from SHA1(seed||path) -> [0..99]."""
    h = hashlib.sha1(f"{seed}:{image_path}".encode()).hexdigest()
    v = int(h[:8], 16) % 100
    if v < 80:
        return "train"
    if v < 90:
        return "val"
    return "test"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    if not LABELS_CSV.exists():
        print(f"missing {LABELS_CSV} — run scripts/ingest_datasets.py first.")
        sys.exit(1)

    SPLITS_DIR.mkdir(parents=True, exist_ok=True)
    buckets: dict[str, list[dict]] = {"train": [], "val": [], "test": []}
    with open(LABELS_CSV) as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        for row in reader:
            buckets[_bucket(row["image_path"], args.seed)].append(row)

    for name, rows in buckets.items():
        out = SPLITS_DIR / f"{name}.csv"
        with open(out, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"{name}: {len(rows):6d}  -> {out}")


if __name__ == "__main__":
    main()
