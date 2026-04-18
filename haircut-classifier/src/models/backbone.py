"""OpenCLIP backbone loader used for both training and zero-shot inference.

MobileCLIP is swappable in for deployment — see src/inference/export.py. At this
layer we only need the image encoder, text encoder, preprocess transform, and
tokenizer. Keep the surface tiny so the choice of backbone is a one-line swap.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import torch

try:
    import open_clip
except ImportError as e:
    raise ImportError(
        "open_clip_torch is required. pip install -r requirements.txt"
    ) from e


@dataclass
class Backbone:
    model: torch.nn.Module
    preprocess: Callable
    tokenizer: Callable
    embed_dim: int
    device: torch.device


def load_backbone(
    name: str = "ViT-B-32",
    pretrained: str = "laion2b_s34b_b79k",
    device: str | torch.device | None = None,
) -> Backbone:
    if device is None:
        device = "cuda" if torch.cuda.is_available() else (
            "mps" if torch.backends.mps.is_available() else "cpu"
        )
    device = torch.device(device)

    model, _, preprocess = open_clip.create_model_and_transforms(
        name, pretrained=pretrained, device=device
    )
    model.eval()
    tokenizer = open_clip.get_tokenizer(name)
    embed_dim = model.visual.output_dim

    return Backbone(
        model=model,
        preprocess=preprocess,
        tokenizer=tokenizer,
        embed_dim=embed_dim,
        device=device,
    )


@torch.inference_mode()
def encode_texts(backbone: Backbone, texts: list[str]) -> torch.Tensor:
    tokens = backbone.tokenizer(texts).to(backbone.device)
    feats = backbone.model.encode_text(tokens)
    return torch.nn.functional.normalize(feats, dim=-1)


@torch.inference_mode()
def encode_images(backbone: Backbone, pil_images: list) -> torch.Tensor:
    batch = torch.stack([backbone.preprocess(img) for img in pil_images]).to(
        backbone.device
    )
    feats = backbone.model.encode_image(batch)
    return torch.nn.functional.normalize(feats, dim=-1)
