"""M4 zero-shot baseline runner.

- Builds text prototypes for the frozen taxonomy.
- If a split CSV is given, evaluates top-1 / top-3 / macro-F1 and writes
  outputs/reports/zero_shot.md.
- If no split CSV exists yet (M2 not done), still succeeds: encodes a few
  example prompts and prints their nearest style_id, so the pipeline is
  provably wired.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from torch.utils.data import DataLoader  # noqa: E402
from tqdm import tqdm  # noqa: E402

from src.config import REPORTS_DIR, SPLITS_DIR  # noqa: E402
from src.data.dataset import HaircutDataset  # noqa: E402
from src.eval.metrics import compute  # noqa: E402
from src.eval.report import write_report  # noqa: E402
from src.inference.predict import Classifier  # noqa: E402


SMOKE_PROMPTS = [
    "short textured crop with messy fringe",
    "high skin fade with long pompadour on top",
    "shoulder-length blunt bob with no layers",
    "box braids in a high top knot",
    "classic buzz cut, very short and uniform",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", default="val", choices=["val", "test"])
    parser.add_argument("--smoke", action="store_true",
                        help="Just encode SMOKE_PROMPTS and print top-3.")
    args = parser.parse_args()

    clf = Classifier()

    split_csv = SPLITS_DIR / f"{args.split}.csv"
    if args.smoke or not split_csv.exists():
        if not split_csv.exists():
            print(f"[zero-shot] no split file at {split_csv} — running smoke only.")
        for prompt in SMOKE_PROMPTS:
            out = clf.classify_text(prompt)
            print(f"\n> {prompt}")
            for sid, conf in out["topk"]:
                print(f"    {sid:40s} {conf:.3f}")
        return

    ds = HaircutDataset(args.split, clf.backbone.preprocess, sample_prompt=False)
    loader = DataLoader(ds, batch_size=128, num_workers=2)
    num_classes = len(ds.style_ids)

    # Prototype embeddings are aligned to clf.prototypes.style_ids; reorder to
    # match dataset label indices (ds.style_ids).
    proto_sid_to_idx = {sid: i for i, sid in enumerate(clf.prototypes.style_ids)}
    reorder = torch.tensor(
        [proto_sid_to_idx[sid] for sid in ds.style_ids], dtype=torch.long
    )
    protos = clf.prototypes.embeddings[reorder].to(clf.backbone.device)

    all_logits, all_labels = [], []
    with torch.no_grad():
        for imgs, ys, _ in tqdm(loader, desc=f"zero-shot {args.split}"):
            imgs = imgs.to(clf.backbone.device)
            feats = clf.backbone.model.encode_image(imgs)
            feats = F.normalize(feats, dim=-1)
            sims = feats @ protos.T  # (B, C), cosine similarities
            # Match Classifier's scaling: logits = sims / T, temp=1 at zero-shot
            all_logits.append((sims * 100.0).cpu())
            all_labels.append(ys)
    logits = torch.cat(all_logits)
    labels = torch.cat(all_labels)

    metrics = compute(logits, labels, num_classes)
    write_report(
        REPORTS_DIR / "zero_shot.md",
        f"Zero-shot (prompt prototypes, split={args.split})",
        metrics,
        ds.style_ids,
        extras={"num_classes": str(num_classes)},
    )
    print(f"[zero-shot] top1={metrics.top1:.3f}  top3={metrics.top3:.3f}  "
          f"macroF1={metrics.macro_f1:.3f}")


if __name__ == "__main__":
    main()
