"""M7: learn temperature + thresholds on val, write them into the checkpoint
so the serving Classifier picks them up automatically."""
from __future__ import annotations

import sys
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.config import CHECKPOINTS_DIR, REPORTS_DIR, TrainConfig  # noqa: E402
from src.data.dataset import HaircutDataset  # noqa: E402
from src.eval.calibration import learn_temperature, pick_thresholds  # noqa: E402
from src.models.backbone import load_backbone  # noqa: E402
from src.models.classifier import HaircutClassifier  # noqa: E402


def main() -> None:
    ckpt_path = CHECKPOINTS_DIR / "fine_tune_latest.pt"
    if not ckpt_path.exists():
        print(f"missing {ckpt_path}; run fine-tune first.")
        sys.exit(1)
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
    logits_all, labels_all = [], []
    with torch.no_grad():
        for imgs, ys, _ in loader:
            imgs = imgs.to(backbone.device)
            logits, _ = model(imgs)
            logits_all.append(logits.cpu())
            labels_all.append(ys)
    logits = torch.cat(logits_all)
    labels = torch.cat(labels_all)

    T = learn_temperature(logits, labels)
    probs = F.softmax(logits / T, dim=-1)
    conf_thr, amb_thr = pick_thresholds(probs, labels)
    print(f"[calibration] T={T:.3f} confident={conf_thr:.3f} ambiguous={amb_thr:.3f}")

    ckpt["temperature"] = T
    ckpt["confident_threshold"] = conf_thr
    ckpt["ambiguous_threshold"] = amb_thr
    torch.save(ckpt, ckpt_path)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "calibration.md").write_text(
        f"# Calibration\n\n"
        f"- learned temperature: **{T:.3f}**\n"
        f"- confident threshold: **{conf_thr:.3f}**\n"
        f"- ambiguous threshold: **{amb_thr:.3f}**\n"
    )


if __name__ == "__main__":
    main()
