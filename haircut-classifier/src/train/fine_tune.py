"""M5 fine-tune: CE over taxonomy + contrastive alignment to sampled prompts.

Implements:
  - Class-balanced sampling via src.data.sampler.ClassBalancedSampler
  - Optional hard-negative boost (used by M6 retraining)
  - Train-time horizontal flip suppressed for asymmetric styles
  - Contrastive loss over per-image sampled prompts
  - Saves checkpoints/fine_tune_latest.pt and writes outputs/reports/fine_tune.md

This is an unoptimized reference loop — readable over fast. For a real run,
add gradient accumulation, AMP, and a cosine LR schedule.
"""
from __future__ import annotations

import copy

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from tqdm import tqdm

from src.config import CHECKPOINTS_DIR, REPORTS_DIR, TrainConfig
from src.data.dataset import HaircutDataset
from src.data.sampler import ClassBalancedSampler, load_default_confused_pairs
from src.eval.confusion import top_confused_pairs
from src.eval.metrics import compute
from src.eval.report import write_report
from src.models.backbone import load_backbone
from src.models.classifier import HaircutClassifier, wise_ft
from src.models.losses import ContrastiveLoss, cross_entropy_loss


def _tokenize_prompts(backbone, prompts: list[str]) -> torch.Tensor:
    return backbone.tokenizer(prompts).to(backbone.device)


def run(cfg: TrainConfig | None = None) -> None:
    cfg = cfg or TrainConfig()
    backbone = load_backbone(name=cfg.backbone, pretrained=cfg.pretrained)
    zero_shot_state = copy.deepcopy(backbone.model.state_dict())

    train_ds = HaircutDataset(
        "train",
        backbone.preprocess,
        sample_prompt=True,
        augment=True,
    )
    val_ds = HaircutDataset("val", backbone.preprocess, sample_prompt=False)
    num_classes = len(train_ds.style_ids)

    confused = load_default_confused_pairs() if cfg.class_balanced_sampling else None
    sampler = ClassBalancedSampler(
        train_ds,
        confused_pairs=confused,
        boost=cfg.hard_negative_boost,
        seed=cfg.seed,
    ) if cfg.class_balanced_sampling else None

    train_loader = DataLoader(
        train_ds, batch_size=cfg.batch_size, sampler=sampler,
        shuffle=(sampler is None), num_workers=2,
    )
    val_loader = DataLoader(val_ds, batch_size=cfg.batch_size, num_workers=2)

    model = HaircutClassifier(backbone, num_classes=num_classes).to(backbone.device)
    contrastive = ContrastiveLoss().to(backbone.device)

    # Two param groups: the CE head sits on top of L2-normalized features and
    # needs a much higher lr than the full 150M-param CLIP backbone.
    head_lr = cfg.lr * 100.0
    opt = torch.optim.AdamW(
        [
            {"params": model.backbone.model.parameters(), "lr": cfg.lr},
            {"params": model.head.parameters(), "lr": head_lr},
            {"params": contrastive.parameters(), "lr": head_lr},
        ],
        weight_decay=cfg.weight_decay,
    )

    for epoch in range(cfg.epochs):
        model.train()
        pbar = tqdm(train_loader, desc=f"ft epoch {epoch}")
        for imgs, ys, prompts in pbar:
            imgs = imgs.to(backbone.device)
            ys = ys.to(backbone.device)

            logits, img_feat = model(imgs)

            tokens = _tokenize_prompts(backbone, list(prompts))
            text_feat = model.encode_text_feat(tokens)

            loss_ce = cross_entropy_loss(logits, ys)
            loss_con = contrastive(img_feat, text_feat)
            loss = loss_ce + cfg.contrastive_weight * loss_con

            opt.zero_grad()
            loss.backward()
            opt.step()
            pbar.set_postfix(ce=f"{loss_ce.item():.3f}", con=f"{loss_con.item():.3f}")

        # ---- val ----
        model.eval()
        all_logits, all_labels = [], []
        with torch.no_grad():
            for imgs, ys, _ in val_loader:
                imgs = imgs.to(backbone.device)
                logits, _ = model(imgs)
                all_logits.append(logits.cpu())
                all_labels.append(ys)
        logits = torch.cat(all_logits)
        labels = torch.cat(all_labels)
        metrics = compute(logits, labels, num_classes)
        print(
            f"[ft][epoch {epoch}] top1={metrics.top1:.3f} "
            f"top3={metrics.top3:.3f} macroF1={metrics.macro_f1:.3f}"
        )

    # Save fine-tuned + WiSE-FT interpolated encoders
    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    ft_state = model.backbone.model.state_dict()
    wise_state = wise_ft(zero_shot_state, ft_state, cfg.wise_ft_alpha)
    torch.save(
        {
            "cfg": cfg.__dict__,
            "head_state": model.head.state_dict(),
            "backbone_fine_tuned": ft_state,
            "backbone_wise_ft": wise_state,
            "contrastive_logit_scale": float(contrastive.logit_scale.detach().item()),
        },
        CHECKPOINTS_DIR / "fine_tune_latest.pt",
    )

    # Confused pairs report
    confused_top = top_confused_pairs(metrics.confusion, k=20)
    confused_named = [
        (train_ds.style_ids[p.a_idx], train_ds.style_ids[p.b_idx], p.count)
        for p in confused_top
    ]
    write_report(
        REPORTS_DIR / "fine_tune.md",
        "Fine-tune (CE + contrastive, OpenCLIP ViT-B/32)",
        metrics,
        train_ds.style_ids,
        top_confused=confused_named,
        extras={
            "epochs": str(cfg.epochs),
            "lambda_contrastive": str(cfg.contrastive_weight),
            "class_balanced": str(cfg.class_balanced_sampling),
            "hard_negative_boost": str(cfg.hard_negative_boost),
            "wise_ft_alpha": str(cfg.wise_ft_alpha),
        },
    )
