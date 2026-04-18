"""M2 gate: splits are source-disjoint, labels are in taxonomy, minimum
train coverage met. Skipped when no dataset has been ingested yet so CI can
still pass before M2 data lands."""
from __future__ import annotations

import csv
import json

import pytest

from src.config import LABELS_CSV, SPLITS_DIR, TAXONOMY_JSON


MIN_TRAIN_PER_CLASS = 50


def _valid_ids() -> set[str]:
    with open(TAXONOMY_JSON) as f:
        return {s["id"] for s in json.load(f)["styles"]}


def _read(split: str):
    path = SPLITS_DIR / f"{split}.csv"
    if not path.exists():
        pytest.skip(f"no {path} — run ingest + make_splits first")
    with open(path) as f:
        return list(csv.DictReader(f))


def test_labels_csv_present():
    if not LABELS_CSV.exists():
        pytest.skip("labels.csv not built yet")
    with open(LABELS_CSV) as f:
        rows = list(csv.DictReader(f))
    assert rows, "labels.csv is empty"
    ids = _valid_ids()
    for r in rows:
        assert r["style_id"] in ids, f"unknown style_id in labels.csv: {r['style_id']}"


def test_splits_are_image_disjoint():
    seen: dict[str, str] = {}
    for split in ("train", "val", "test"):
        for r in _read(split):
            p = r["image_path"]
            assert p not in seen, f"{p} in both {seen[p]} and {split}"
            seen[p] = split


def test_split_labels_are_in_taxonomy():
    ids = _valid_ids()
    for split in ("train", "val", "test"):
        for r in _read(split):
            assert r["style_id"] in ids


def test_train_covers_every_class_adequately():
    ids = _valid_ids()
    rows = _read("train")
    counts: dict[str, int] = {sid: 0 for sid in ids}
    for r in rows:
        counts[r["style_id"]] = counts.get(r["style_id"], 0) + 1
    thin = [sid for sid, c in counts.items() if c < MIN_TRAIN_PER_CLASS]
    assert not thin, (
        f"{len(thin)} classes under {MIN_TRAIN_PER_CLASS} training samples: "
        + ", ".join(thin[:10])
    )
