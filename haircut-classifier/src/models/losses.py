"""Loss components for M5.

L = L_CE + lambda * L_contrastive

- L_CE: cross-entropy over style_ids. Makes the classifier obey the taxonomy.
- L_contrastive: symmetric InfoNCE between image features and sampled
  per-example prompts. Keeps the text side aligned so prompt-based inference
  stays useful after fine-tuning.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


def cross_entropy_loss(logits: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
    return F.cross_entropy(logits, labels)


class ContrastiveLoss(nn.Module):
    """Symmetric InfoNCE with a learnable temperature."""

    def __init__(self, init_logit_scale: float = 2.6593):  # ln(1/0.07)
        super().__init__()
        self.logit_scale = nn.Parameter(torch.tensor(init_logit_scale))

    def forward(
        self, image_feats: torch.Tensor, text_feats: torch.Tensor
    ) -> torch.Tensor:
        # Both tensors must be L2-normalized.
        scale = self.logit_scale.exp().clamp(max=100.0)
        logits_per_image = scale * image_feats @ text_feats.T
        logits_per_text = logits_per_image.T
        targets = torch.arange(image_feats.shape[0], device=image_feats.device)
        return 0.5 * (
            F.cross_entropy(logits_per_image, targets)
            + F.cross_entropy(logits_per_text, targets)
        )
