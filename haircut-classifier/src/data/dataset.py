"""Torch Dataset over labels.csv — emits (image_tensor, label_idx, prompt)."""
from __future__ import annotations

import csv
import json
import random
from pathlib import Path
from typing import Callable

import torch
from PIL import Image, ImageFile
from torch.utils.data import Dataset

# Scraped web images sometimes truncate a few bytes at the end; load them
# partially rather than crash the whole epoch.
ImageFile.LOAD_TRUNCATED_IMAGES = True

from src.config import PROMPTS_JSON, SPLITS_DIR, TAXONOMY_JSON
from src.data.transforms import training_wrap
from src.inference.predict import build_prompts_for_style


def load_style_ids() -> list[str]:
    with open(TAXONOMY_JSON) as f:
        return [s["id"] for s in json.load(f)["styles"]]


def load_prompt_bank() -> dict[str, list[str]]:
    """Return {style_id: [prompt strings, ...]}."""
    with open(PROMPTS_JSON) as f:
        prompts = json.load(f)
    templates = prompts["templates"]
    out = {}
    for sid, info in prompts["by_style"].items():
        out[sid] = build_prompts_for_style(templates, info["synonyms"])
    return out


class HaircutDataset(Dataset):
    def __init__(
        self,
        split: str,
        preprocess: Callable,
        sample_prompt: bool = True,
        augment: bool = False,
    ):
        csv_path = SPLITS_DIR / f"{split}.csv"
        if not csv_path.exists():
            raise FileNotFoundError(
                f"missing {csv_path} — run scripts/ingest_datasets.py then "
                "scripts/make_splits.py first."
            )
        with open(csv_path) as f:
            self.rows = list(csv.DictReader(f))
        self.preprocess = preprocess
        self.sample_prompt = sample_prompt
        self.augment = augment
        self._augmented_preprocess: dict[str, Callable] = {}

        self.style_ids = load_style_ids()
        self.sid_to_idx = {sid: i for i, sid in enumerate(self.style_ids)}
        self.prompt_bank = load_prompt_bank()

    def __len__(self) -> int:
        return len(self.rows)

    def labels(self) -> list[int]:
        return [self.sid_to_idx[r["style_id"]] for r in self.rows]

    def __getitem__(self, i: int):
        row = self.rows[i]
        try:
            img = Image.open(row["image_path"]).convert("RGB")
        except Exception:
            # Corrupt image: fall back to the next row rather than crash.
            return self.__getitem__((i + 1) % len(self.rows))
        preprocess = self.preprocess
        if self.augment:
            style_id = row["style_id"]
            preprocess = self._augmented_preprocess.setdefault(
                style_id,
                training_wrap(self.preprocess, style_id),
            )
        x = preprocess(img)
        y = self.sid_to_idx[row["style_id"]]
        prompt = (
            random.choice(self.prompt_bank[row["style_id"]])
            if self.sample_prompt
            else self.prompt_bank[row["style_id"]][0]
        )
        return x, y, prompt
