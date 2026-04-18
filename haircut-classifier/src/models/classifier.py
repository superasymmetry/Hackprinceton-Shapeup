"""HaircutClassifier: OpenCLIP image encoder + linear CE head over style_ids.

The text encoder is kept alongside so the contrastive loss can align image
features to prompt embeddings in the same pass. At inference we can drop the
CE head and use either (a) the fine-tuned image features vs. text prototypes,
or (b) WiSE-FT interpolation between the fine-tuned and zero-shot image
encoders — see src/inference/predict.py.
"""
from __future__ import annotations

import copy

import torch
import torch.nn as nn
import torch.nn.functional as F

from src.models.backbone import Backbone


class HaircutClassifier(nn.Module):
    def __init__(self, backbone: Backbone, num_classes: int):
        super().__init__()
        self.backbone = backbone
        self.head = nn.Linear(backbone.embed_dim, num_classes, bias=True)

    def encode_image_feat(self, images: torch.Tensor) -> torch.Tensor:
        feats = self.backbone.model.encode_image(images)
        return F.normalize(feats, dim=-1)

    def encode_text_feat(self, tokens: torch.Tensor) -> torch.Tensor:
        feats = self.backbone.model.encode_text(tokens)
        return F.normalize(feats, dim=-1)

    def forward(self, images: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Returns (logits, normalized_image_features)."""
        img_feat = self.encode_image_feat(images)
        logits = self.head(img_feat)
        return logits, img_feat


def wise_ft(
    zero_shot_state: dict[str, torch.Tensor],
    fine_tuned_state: dict[str, torch.Tensor],
    alpha: float,
) -> dict[str, torch.Tensor]:
    """WiSE-FT: linearly interpolate encoder weights (shared keys only).

    alpha=0 -> pure zero-shot, alpha=1 -> pure fine-tuned. 0.5 typically
    improves robustness under distribution shift without hurting in-domain
    accuracy. We only touch keys that exist in BOTH states, so the CE head
    (absent in zero-shot) is preserved from fine_tuned.
    """
    out = copy.deepcopy(fine_tuned_state)
    for k, v_ft in fine_tuned_state.items():
        if k in zero_shot_state and zero_shot_state[k].shape == v_ft.shape:
            v_zs = zero_shot_state[k]
            out[k] = (1 - alpha) * v_zs + alpha * v_ft
    return out
