"""Image -> style_id and text -> style_id inference.

Strategy:
- Build a text prototype per style_id by averaging embeddings over all
  (template, synonym) prompt combinations. This is the zero-shot classifier
  and also powers the contrastive head of the fine-tuned model.
- For images: encode, cosine-similarity against prototypes, softmax over the
  taxonomy, return top-k with calibrated confidence.
- For text: encode the user's prompt, nearest-prototype, same return shape.

When a fine-tuned checkpoint is present, we use WiSE-FT (weight-space
interpolation) between the zero-shot and fine-tuned image encoders at
`ServingConfig.wise_ft_alpha`. If no checkpoint, we run pure zero-shot —
this is what makes the FastAPI service runnable on day one.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import torch
import torch.nn.functional as F
from PIL import Image

from src.config import (
    CHECKPOINTS_DIR,
    HARD_NEGATIVES_JSON,
    PROMPTS_JSON,
    TAXONOMY_JSON,
    ServingConfig,
)
from src.models.backbone import Backbone, encode_images, encode_texts, load_backbone


def _load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def build_prompts_for_style(
    templates: list[str], synonyms: list[str]
) -> list[str]:
    """Cartesian product of templates and synonyms, deduplicated."""
    out = []
    seen = set()
    for t in templates:
        for s in synonyms:
            p = t.format(style=s)
            if p not in seen:
                seen.add(p)
                out.append(p)
    return out


@dataclass
class Prototypes:
    style_ids: list[str]
    embeddings: torch.Tensor  # (num_styles, embed_dim), L2-normalized


def build_prototypes(backbone: Backbone) -> Prototypes:
    taxonomy = _load_json(TAXONOMY_JSON)
    prompts = _load_json(PROMPTS_JSON)
    templates = prompts["templates"]

    style_ids: list[str] = []
    proto_vecs: list[torch.Tensor] = []

    for style in taxonomy["styles"]:
        sid = style["id"]
        syns = prompts["by_style"][sid]["synonyms"]
        class_prompts = build_prompts_for_style(templates, syns)
        # Encode in one batch (smallish set: 12 templates x 3-6 synonyms ≈ 36-72)
        feats = encode_texts(backbone, class_prompts)  # (n, d), L2-normed
        proto = feats.mean(dim=0)
        proto = F.normalize(proto, dim=-1)
        style_ids.append(sid)
        proto_vecs.append(proto)

    embeddings = torch.stack(proto_vecs, dim=0).to(backbone.device)
    return Prototypes(style_ids=style_ids, embeddings=embeddings)


class Classifier:
    def __init__(
        self,
        backbone: Backbone | None = None,
        cfg: ServingConfig | None = None,
    ):
        self.backbone = backbone or load_backbone()
        self.cfg = cfg or ServingConfig()
        self.temperature = 1.0  # overridden by calibration.py when available
        self._load_fine_tune_if_present()
        self.prototypes = build_prototypes(self.backbone)

    def _load_fine_tune_if_present(self) -> None:
        """If a fine-tune checkpoint exists, load the WiSE-FT-interpolated image
        encoder into the backbone. Text encoder stays zero-shot so prompt
        prototypes remain well-behaved. Silently no-ops when no checkpoint."""
        ckpt_path = Path(self.cfg.checkpoint) if self.cfg.checkpoint else (
            CHECKPOINTS_DIR / "fine_tune_latest.pt"
        )
        if not ckpt_path.is_absolute():
            ckpt_path = Path.cwd() / ckpt_path
        if not ckpt_path.exists():
            return
        try:
            ckpt = torch.load(ckpt_path, map_location=self.backbone.device)
        except Exception as e:
            print(f"[classifier] could not load checkpoint {ckpt_path}: {e}")
            return
        state = ckpt.get("backbone_wise_ft") or ckpt.get("backbone_fine_tuned")
        if state is not None:
            missing, unexpected = self.backbone.model.load_state_dict(state, strict=False)
            print(f"[classifier] loaded {ckpt_path.name} "
                  f"(missing={len(missing)}, unexpected={len(unexpected)})")
        if "temperature" in ckpt:
            self.temperature = float(ckpt["temperature"])
        if "confident_threshold" in ckpt:
            self.cfg.confident_threshold = float(ckpt["confident_threshold"])
        if "ambiguous_threshold" in ckpt:
            self.cfg.ambiguous_threshold = float(ckpt["ambiguous_threshold"])

    def _topk_from_sims(self, sims: torch.Tensor) -> list[tuple[str, float]]:
        """sims: (num_styles,) cosine similarities in [-1, 1]."""
        logits = sims / self.temperature
        probs = F.softmax(logits * 100.0, dim=-1)  # scale like CLIP
        topk = torch.topk(probs, k=self.cfg.top_k)
        return [
            (self.prototypes.style_ids[i.item()], float(p.item()))
            for p, i in zip(topk.values, topk.indices)
        ]

    def _dispatch_confidence(
        self, topk: list[tuple[str, float]]
    ) -> tuple[str, float]:
        top1_sid, top1_conf = topk[0]
        if top1_conf < self.cfg.ambiguous_threshold:
            return "unknown_or_ambiguous", top1_conf
        if top1_conf < self.cfg.confident_threshold:
            # Caller should treat as ambiguous and show top-k; still return
            # the raw top-1 so they can display it as a guess.
            return top1_sid, top1_conf
        return top1_sid, top1_conf

    @torch.inference_mode()
    def classify_image(self, image: Image.Image) -> dict:
        img_feat = encode_images(self.backbone, [image.convert("RGB")])  # (1, d)
        sims = (img_feat @ self.prototypes.embeddings.T).squeeze(0)
        topk = self._topk_from_sims(sims)
        top1_sid, top1_conf = self._dispatch_confidence(topk)
        return {
            "top1_style_id": top1_sid,
            "top1_confidence": top1_conf,
            "topk": [[sid, conf] for sid, conf in topk],
        }

    @torch.inference_mode()
    def classify_text(self, prompt: str) -> dict:
        feat = encode_texts(self.backbone, [prompt])  # (1, d)
        sims = (feat @ self.prototypes.embeddings.T).squeeze(0)
        topk = self._topk_from_sims(sims)
        top1_sid, top1_conf = self._dispatch_confidence(topk)
        return {
            "top1_style_id": top1_sid,
            "top1_confidence": top1_conf,
            "topk": [[sid, conf] for sid, conf in topk],
        }


_SINGLETON: Classifier | None = None


def get_classifier() -> Classifier:
    """Lazy singleton for the FastAPI server (don't load CLIP on import)."""
    global _SINGLETON
    if _SINGLETON is None:
        _SINGLETON = Classifier()
    return _SINGLETON
