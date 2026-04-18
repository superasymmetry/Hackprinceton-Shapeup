"""Temperature scaling on val logits + threshold picker for unknown/ambiguous."""
from __future__ import annotations

import torch
import torch.nn.functional as F


def learn_temperature(
    logits: torch.Tensor, labels: torch.Tensor, max_iter: int = 100
) -> float:
    """LBFGS temperature scaling (Guo et al., 2017)."""
    T = torch.ones(1, requires_grad=True)
    opt = torch.optim.LBFGS([T], lr=0.1, max_iter=max_iter)

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / T.clamp(min=1e-3), labels)
        loss.backward()
        return loss

    opt.step(closure)
    return float(T.detach().clamp(min=1e-3).item())


def pick_thresholds(
    probs: torch.Tensor,
    labels: torch.Tensor,
    target_precision: float = 0.9,
) -> tuple[float, float]:
    """Return (confident_threshold, ambiguous_threshold).

    confident_threshold: lowest top-1 prob at which top-1 precision >= target.
    ambiguous_threshold: below this, return "unknown_or_ambiguous" from the
                         serving layer. Fixed at 0.5 * confident_threshold.
    """
    top1_probs, preds = probs.max(dim=-1)
    correct = (preds == labels)
    sorted_order = torch.argsort(top1_probs, descending=True)
    sorted_correct = correct[sorted_order]
    sorted_probs = top1_probs[sorted_order]

    confident = 0.55
    for i in range(1, len(sorted_order) + 1):
        prec = sorted_correct[:i].float().mean().item()
        if prec < target_precision:
            confident = float(sorted_probs[i - 1].item())
            break
    ambiguous = confident * 0.5
    return confident, ambiguous
