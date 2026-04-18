"""Frozen-backbone linear probe over style_ids. Baseline for M4."""
from __future__ import annotations

from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from tqdm import tqdm

from src.config import CHECKPOINTS_DIR, REPORTS_DIR, TrainConfig
from src.data.dataset import HaircutDataset
from src.eval.metrics import compute
from src.eval.report import write_report
from src.models.backbone import load_backbone


def run(cfg: TrainConfig | None = None, epochs: int = 10, lr: float = 1e-2) -> None:
    cfg = cfg or TrainConfig()
    backbone = load_backbone(name=cfg.backbone, pretrained=cfg.pretrained)
    # Freeze the backbone.
    for p in backbone.model.parameters():
        p.requires_grad = False
    backbone.model.eval()

    train_ds = HaircutDataset("train", backbone.preprocess, sample_prompt=False)
    val_ds = HaircutDataset("val", backbone.preprocess, sample_prompt=False)
    train_loader = DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True, num_workers=2)
    val_loader = DataLoader(val_ds, batch_size=cfg.batch_size, shuffle=False, num_workers=2)

    num_classes = len(train_ds.style_ids)
    head = nn.Linear(backbone.embed_dim, num_classes).to(backbone.device)
    # Linear head over L2-normalized features needs a much higher lr than the
    # full fine-tune; cfg.lr (1e-4) is for fine-tuning, not probes.
    opt = torch.optim.AdamW(head.parameters(), lr=lr, weight_decay=cfg.weight_decay)

    # Frozen backbone: cache image features once, then train the head directly
    # on CPU tensors. 100× faster than re-encoding every epoch.
    def _cache_features(loader) -> tuple[torch.Tensor, torch.Tensor]:
        feats_all, labels_all = [], []
        with torch.no_grad():
            for imgs, ys, _ in tqdm(loader, desc="cache feats"):
                imgs = imgs.to(backbone.device)
                f = backbone.model.encode_image(imgs)
                f = nn.functional.normalize(f, dim=-1)
                feats_all.append(f.cpu())
                labels_all.append(ys)
        return torch.cat(feats_all), torch.cat(labels_all)

    train_feats, train_labels = _cache_features(train_loader)
    val_feats, val_labels = _cache_features(val_loader)

    train_feats = train_feats.to(backbone.device)
    train_labels = train_labels.to(backbone.device)

    n = train_feats.shape[0]
    for epoch in range(epochs):
        head.train()
        perm = torch.randperm(n, device=backbone.device)
        epoch_loss = 0.0
        for i in range(0, n, cfg.batch_size):
            idx = perm[i:i + cfg.batch_size]
            logits = head(train_feats[idx])
            loss = nn.functional.cross_entropy(logits, train_labels[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            epoch_loss += float(loss.item())
        print(f"probe epoch {epoch}  loss={epoch_loss / (n // cfg.batch_size + 1):.4f}")

    # Eval on val
    head.eval()
    with torch.no_grad():
        logits = head(val_feats.to(backbone.device)).cpu()
    labels = val_labels
    metrics = compute(logits, labels, num_classes)

    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    torch.save({"head_state": head.state_dict(), "cfg": cfg.__dict__},
               CHECKPOINTS_DIR / "linear_probe.pt")
    write_report(
        REPORTS_DIR / "linear_probe.md",
        "Linear probe (frozen OpenCLIP ViT-B/32)",
        metrics,
        train_ds.style_ids,
        extras={"epochs": str(epochs), "backbone": cfg.backbone},
    )
    print(f"[probe] top1={metrics.top1:.3f}  top3={metrics.top3:.3f}  macroF1={metrics.macro_f1:.3f}")
