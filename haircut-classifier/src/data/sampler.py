"""Class-balanced sampler with optional hard-negative boost.

Each epoch samples len(dataset) indices. With class_balanced=True, classes are
sampled uniformly first, then an image is picked from the chosen class — this
prevents CLIP's head-tail class imbalance from dominating gradients. When
`confused_pairs` is provided, the classes in those pairs get a `boost` multiplier
on their sampling weight, which is how M6 escalates effort on hard confusables.
"""
from __future__ import annotations

import json
import random
from collections import defaultdict

from torch.utils.data import Sampler

from src.config import HARD_NEGATIVES_JSON, TAXONOMY_DIR
from src.data.dataset import HaircutDataset


def load_default_confused_pairs() -> list[tuple[str, str]]:
    """Runtime overrides from M6 mining take precedence over the frozen graph."""
    runtime = TAXONOMY_DIR / "hard_negatives.runtime.json"
    if runtime.exists():
        data = json.loads(runtime.read_text())
        return [(row[0], row[1]) for row in data.get("pairs", [])]

    with open(HARD_NEGATIVES_JSON) as f:
        graph = json.load(f)["pairs"]
    seen, out = set(), []
    for a, negs in graph.items():
        for b in negs:
            key = tuple(sorted((a, b)))
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
    return out


class ClassBalancedSampler(Sampler):
    def __init__(
        self,
        dataset: HaircutDataset,
        num_samples: int | None = None,
        confused_pairs: list[tuple[str, str]] | None = None,
        boost: float = 2.0,
        seed: int = 0,
    ):
        self.dataset = dataset
        self.num_samples = num_samples or len(dataset)
        self.rng = random.Random(seed)

        # Index rows by class label.
        self.by_label: dict[int, list[int]] = defaultdict(list)
        for i, y in enumerate(dataset.labels()):
            self.by_label[y].append(i)
        self.labels = sorted(self.by_label)

        # Per-class weight: 1.0 baseline, boost for classes in confused pairs.
        boosted = set()
        if confused_pairs:
            sid2idx = dataset.sid_to_idx
            for a, b in confused_pairs:
                if a in sid2idx:
                    boosted.add(sid2idx[a])
                if b in sid2idx:
                    boosted.add(sid2idx[b])
        self.class_weights = [
            boost if y in boosted else 1.0 for y in self.labels
        ]

    def __iter__(self):
        for _ in range(self.num_samples):
            y = self.rng.choices(self.labels, weights=self.class_weights, k=1)[0]
            pool = self.by_label[y]
            yield pool[self.rng.randrange(len(pool))]

    def __len__(self) -> int:
        return self.num_samples
