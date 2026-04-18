"""M2: walk downloaded datasets, apply taxonomy_map.json, emit labels.csv + rejects.csv.

Assumed on-disk layout produced by scripts/download_datasets.sh:

    data/raw/hairstyle30k/<class_name>/*.jpg
    data/raw/k_hairstyle/images/<class_name>/*.jpg          (post-unpack)
    data/raw/celebamask_hq/CelebA-HQ-img/*.jpg              (no style labels)

Hairstyle30k and K-Hairstyle give us class-folder structure; we map folder
names to style_ids via taxonomy/taxonomy_map.json. CelebAMask-HQ has no style
labels, so we don't pull images from it here — it's only used in M3 for the
hair-parser auxiliary.

Output labels.csv columns:
    image_path,style_id,source,source_class,view,quality,occlusion,notes
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from src.config import (
    LABELS_CSV,
    RAW_DIR,
    REJECTS_CSV,
    TAXONOMY_JSON,
    TAXONOMY_MAP_JSON,
)


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def _load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def _valid_style_ids() -> set[str]:
    return {s["id"] for s in _load_json(TAXONOMY_JSON)["styles"]}


def _iter_class_folder(source_root: Path):
    """Yield (class_folder_name, image_path) pairs from a dataset root that
    has one directory per class."""
    if not source_root.exists():
        return
    for class_dir in sorted(p for p in source_root.iterdir() if p.is_dir()):
        for img in class_dir.rglob("*"):
            if img.is_file() and img.suffix.lower() in IMAGE_SUFFIXES:
                yield class_dir.name, img


def ingest() -> tuple[int, int]:
    valid_ids = _valid_style_ids()
    tmap = _load_json(TAXONOMY_MAP_JSON)

    labels_rows: list[dict] = []
    rejects_rows: list[dict] = []

    sources = [
        ("hairstyle30k", RAW_DIR / "hairstyle30k"),
        ("k_hairstyle", RAW_DIR / "k_hairstyle" / "images"),
        ("hairstyle40", RAW_DIR / "hairstyle40" / "image"),
        ("scraped", RAW_DIR / "scraped"),
    ]

    for source_name, root in sources:
        # scraped: folder name IS the style_id, no mapping needed.
        if source_name == "scraped":
            if not root.exists():
                print(f"[ingest] scraped: {root} missing, skipping.")
                continue
            found_any = False
            for class_name, img_path in _iter_class_folder(root):
                found_any = True
                row = {
                    "image_path": str(img_path.resolve()),
                    "source": source_name,
                    "source_class": class_name,
                    "view": "unknown",
                    "quality": "unknown",
                    "occlusion": "unknown",
                    "notes": "",
                }
                if class_name in valid_ids:
                    labels_rows.append({**row, "style_id": class_name})
                else:
                    rejects_rows.append({**row, "reject_reason": "no_mapping"})
            if not found_any:
                print(f"[ingest] scraped: empty.")
            continue

        mapping = tmap.get(source_name, {})
        if not mapping:
            print(f"[ingest] no mapping for {source_name}, skipping.")
            continue
        found_any = False
        for class_name, img_path in _iter_class_folder(root):
            found_any = True
            target = mapping.get(class_name)
            row = {
                "image_path": str(img_path.resolve()),
                "source": source_name,
                "source_class": class_name,
                "view": "unknown",
                "quality": "unknown",
                "occlusion": "unknown",
                "notes": "",
            }
            if target is None or target.startswith("__") or target not in valid_ids:
                rejects_rows.append(
                    {**row, "reject_reason": "no_mapping" if target is None else "ambiguous"}
                )
                continue
            labels_rows.append({**row, "style_id": target})
        if not found_any:
            print(f"[ingest] {source_name}: directory {root} empty or missing.")

    LABELS_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(LABELS_CSV, "w", newline="") as f:
        if labels_rows:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    "image_path", "style_id", "source", "source_class",
                    "view", "quality", "occlusion", "notes",
                ],
            )
            writer.writeheader()
            writer.writerows(labels_rows)
    with open(REJECTS_CSV, "w", newline="") as f:
        if rejects_rows:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    "image_path", "source", "source_class", "reject_reason",
                    "view", "quality", "occlusion", "notes",
                ],
            )
            writer.writeheader()
            writer.writerows(rejects_rows)

    return len(labels_rows), len(rejects_rows)


if __name__ == "__main__":
    accepted, rejected = ingest()
    print(f"[ingest] accepted={accepted} rejected={rejected}")
    print(f"         labels:  {LABELS_CSV}")
    print(f"         rejects: {REJECTS_CSV}")
