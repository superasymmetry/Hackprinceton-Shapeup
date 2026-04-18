"""Batch wrapper: read labels.csv, run face_detect.crop_batch, rewrite labels.csv
with the new cropped paths, move rejects into rejects.csv.

Usage:
    python -m src.preprocess.hair_crop
"""
from __future__ import annotations

import csv
from pathlib import Path

from src.config import IMAGES_DIR, LABELS_CSV, REJECTS_CSV
from src.preprocess.face_detect import _stable_stem, crop_batch


def run() -> tuple[int, int]:
    if not LABELS_CSV.exists():
        raise FileNotFoundError(f"{LABELS_CSV} missing — run ingest first.")

    with open(LABELS_CSV) as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    by_path = {Path(r["image_path"]): r for r in rows}
    result = crop_batch(list(by_path.keys()), IMAGES_DIR)

    accepted_paths = set(result["accepted"])
    kept: list[dict] = []
    new_rejects: list[dict] = []

    for src_path, row in by_path.items():
        if src_path in accepted_paths:
            # Swap the image_path to the new portrait crop.
            stem = _stable_stem(src_path)
            new_path = IMAGES_DIR / "portrait" / f"{stem}.jpg"
            kept.append({**row, "image_path": str(new_path)})
        else:
            new_rejects.append({**row, "reject_reason": "preprocess"})

    with open(LABELS_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(kept)

    # Append rejects (don't clobber earlier ingest rejects)
    append_header = not REJECTS_CSV.exists()
    with open(REJECTS_CSV, "a", newline="") as f:
        if new_rejects:
            writer = csv.DictWriter(
                f,
                fieldnames=list(new_rejects[0].keys()),
            )
            if append_header:
                writer.writeheader()
            writer.writerows(new_rejects)

    return len(kept), len(new_rejects)


if __name__ == "__main__":
    kept, rejected = run()
    print(f"[preprocess] kept={kept} rejected={rejected}")
