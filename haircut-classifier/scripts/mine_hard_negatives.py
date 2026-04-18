"""M6: read the latest fine-tune run's confusion matrix, extract the top
confused pairs, and relaunch fine_tune with their classes boosted.

Idempotent — each invocation reads the checkpoint, mines, and writes back
taxonomy/hard_negatives.runtime.json (distinct from the frozen file so the
M1 gate stays green) that the sampler will pick up on the next run.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.config import CHECKPOINTS_DIR, TAXONOMY_DIR, TrainConfig  # noqa: E402
from src.data.dataset import HaircutDataset  # noqa: E402
from src.eval.confusion import top_confused_pairs  # noqa: E402
from src.eval.metrics import compute  # noqa: E402
from src.models.backbone import load_backbone  # noqa: E402
from src.models.classifier import HaircutClassifier  # noqa: E402


def mine(k: int = 20) -> Path:
    ckpt_path = CHECKPOINTS_DIR / "fine_tune_latest.pt"
    if not ckpt_path.exists():
        raise FileNotFoundError(
            f"{ckpt_path} not found — run scripts/run_fine_tune.py first."
        )
    ckpt = torch.load(ckpt_path, map_location="cpu")
    cfg = TrainConfig(**ckpt["cfg"])

    backbone = load_backbone(name=cfg.backbone, pretrained=cfg.pretrained)
    val_ds = HaircutDataset("val", backbone.preprocess, sample_prompt=False)
    num_classes = len(val_ds.style_ids)

    model = HaircutClassifier(backbone, num_classes=num_classes).to(backbone.device)
    model.backbone.model.load_state_dict(ckpt["backbone_fine_tuned"])
    model.head.load_state_dict(ckpt["head_state"])
    model.eval()

    loader = DataLoader(val_ds, batch_size=128, num_workers=2)
    all_logits, all_labels = [], []
    with torch.no_grad():
        for imgs, ys, _ in loader:
            imgs = imgs.to(backbone.device)
            logits, _ = model(imgs)
            all_logits.append(logits.cpu())
            all_labels.append(ys)
    logits = torch.cat(all_logits)
    labels = torch.cat(all_labels)
    metrics = compute(logits, labels, num_classes)
    pairs = top_confused_pairs(metrics.confusion, k=k)

    pair_names = [
        [val_ds.style_ids[p.a_idx], val_ds.style_ids[p.b_idx], p.count, p.rate]
        for p in pairs
    ]
    out = TAXONOMY_DIR / "hard_negatives.runtime.json"
    out.write_text(json.dumps({"pairs": pair_names, "top1": metrics.top1}, indent=2))
    print(f"[mine] wrote {out}  ({len(pair_names)} pairs, val top1={metrics.top1:.3f})")
    for a, b, count, rate in pair_names[:10]:
        print(f"    {a:35s} <-> {b:35s}  n={count:4d}  rate={rate:.3f}")
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--k", type=int, default=20)
    args = parser.parse_args()
    mine(k=args.k)
