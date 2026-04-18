"""Top-k accuracy, macro-F1, per-class F1, confusion matrix."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import torch
from sklearn.metrics import f1_score


@dataclass
class Metrics:
    top1: float
    top3: float
    macro_f1: float
    per_class_f1: dict[int, float] = field(default_factory=dict)
    confusion: list[list[int]] = field(default_factory=list)


def compute(
    logits: torch.Tensor, labels: torch.Tensor, num_classes: int
) -> Metrics:
    preds_1 = logits.argmax(dim=-1)
    top1 = (preds_1 == labels).float().mean().item()

    topk = logits.topk(k=min(3, logits.shape[-1]), dim=-1).indices
    top3 = (topk == labels.unsqueeze(-1)).any(dim=-1).float().mean().item()

    y = labels.cpu().numpy()
    p = preds_1.cpu().numpy()
    macro_f1 = float(f1_score(y, p, average="macro", labels=list(range(num_classes)), zero_division=0))
    per = f1_score(y, p, average=None, labels=list(range(num_classes)), zero_division=0)
    per_class_f1 = {i: float(per[i]) for i in range(num_classes)}

    conf = [[0] * num_classes for _ in range(num_classes)]
    for yi, pi in zip(y, p):
        conf[int(yi)][int(pi)] += 1

    return Metrics(
        top1=top1, top3=top3, macro_f1=macro_f1,
        per_class_f1=per_class_f1, confusion=conf,
    )
