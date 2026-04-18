"""M7: learn temperature + thresholds on val, write them into the checkpoint
so the serving Classifier picks them up automatically."""
from __future__ import annotations

import sys
from pathlib import Path

import torch
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.config import CHECKPOINTS_DIR, REPORTS_DIR  # noqa: E402
from src.data.dataset import HaircutDataset  # noqa: E402
from src.eval.calibration import learn_temperature, pick_thresholds  # noqa: E402
from src.inference.predict import Classifier  # noqa: E402


def main() -> None:
    ckpt_path = CHECKPOINTS_DIR / "fine_tune_latest.pt"
    if not ckpt_path.exists():
        print(f"missing {ckpt_path}; run fine-tune first.")
        sys.exit(1)
    ckpt = torch.load(ckpt_path, map_location="cpu")
    clf = Classifier()
    clf.temperature = 1.0

    val_ds = HaircutDataset("val", clf.backbone.preprocess, sample_prompt=False)
    loader = DataLoader(val_ds, batch_size=128, num_workers=2)
    probs_all, labels_all = [], []
    with torch.no_grad():
        for imgs, ys, _ in loader:
            probs_all.append(clf.classify_batch_tensors(imgs).cpu())
            labels_all.append(ys)
    probs = torch.cat(probs_all)
    labels = torch.cat(labels_all)
    logits = (probs.clamp(min=1e-12)).log()

    T = learn_temperature(logits, labels)
    probs = torch.softmax(logits / T, dim=-1)
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
