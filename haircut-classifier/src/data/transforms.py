"""Augmentations on top of the backbone's canonical preprocess.

We wrap open_clip's transform rather than replace it, because the backbone
expects very specific resize+normalize parameters. Training augmentations are
applied before the canonical transform: jitter, horizontal flip (off for
asymmetric styles), random erasing to simulate occlusion.
"""
from __future__ import annotations

from typing import Callable

import torchvision.transforms as T


ASYMMETRIC_STYLE_IDS = {
    "style_035_asymmetric_bob",
    "style_008_side_part",
    "style_009_comb_over",
    "style_024_drop_fade",
    "style_025_temple_fade",
}


def training_wrap(preprocess: Callable, style_id: str | None = None) -> Callable:
    aug = [
        T.RandomResizedCrop(224, scale=(0.8, 1.0), ratio=(0.9, 1.1)),
        T.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.02),
    ]
    if style_id not in ASYMMETRIC_STYLE_IDS:
        aug.insert(0, T.RandomHorizontalFlip(p=0.5))
    pre = T.Compose(aug)

    def composed(pil):
        return preprocess(pre(pil))

    return composed
