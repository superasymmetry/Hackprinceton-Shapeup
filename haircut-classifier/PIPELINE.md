# Haircut Classifier — Pipeline Guide

End-to-end guide to rebuilding, training, and serving the closed-set haircut
classifier. Maps an image or text prompt to one of 50 `style_id`s from a frozen
taxonomy.

## What's in the box

| stage | top-1 | top-3 | macro-F1 |
|---|---|---|---|
| Zero-shot (OpenCLIP ViT-B/32) | 38.7% | 61.1% | 35.5% |
| Linear probe (50 epochs, lr=1e-2) | 55.1% | 80.7% | 53.2% |
| Fine-tune (6 epochs, CE + contrastive, WiSE-FT α=0.5) | 56.6% | 80.1% | 55.3% |

Calibrated thresholds (saved into checkpoint): `T=0.700`, `confident=0.842`, `ambiguous=0.421`.

Training data: **6,388 labeled images** across all 50 classes (min 85 / class).
Source mix: FaceSketches-HairStyle40 (838) + Bing editorial scrape (5,550).

## Prerequisites

- Python **3.14** (the project ships a `.venv` built against it)
- Apple Silicon MPS, CUDA, or CPU — everything auto-detects
- ~2 GB disk for datasets + checkpoint

## Setup

```bash
cd haircut-classifier
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If you're on Python 3.14, `mediapipe` may fail to install or import (its
`solutions` API was removed). The v1 pipeline **does not run face detection**,
so this is harmless — `src/preprocess/face_detect.py` is not invoked by any
training or inference path.

## Run the trained model (inference only)

If `outputs/checkpoints/fine_tune_latest.pt` is already present, you can skip
training entirely.

### Classify an image

```python
from PIL import Image
from src.inference.predict import Classifier

clf = Classifier()
result = clf.classify_image(Image.open("path/to/photo.png").convert("RGB"))
print(result)
# {
#   "top1_style_id": "style_028_flow",
#   "top1_confidence": 1.000,
#   "topk": [["style_028_flow", 1.000], ["style_027_curtains", 0.000], ...]
# }
```

PNG, JPG, and any PIL-openable format works.

### Classify a text prompt

```python
clf.classify_text("high skin fade with long pompadour on top")
# {"top1_style_id": "style_011_pompadour", "top1_confidence": 0.998, ...}
```

### Serve over HTTP

```bash
uvicorn src.api.classifier_server:app --host 0.0.0.0 --port 5003
```

Endpoints:
- `POST /classify/image` — multipart image upload
- `POST /classify/text` — JSON `{"prompt": "..."}`
- `GET /taxonomy` — the frozen taxonomy

```bash
curl -F image=@photo.jpg http://localhost:5003/classify/image
curl -H 'Content-Type: application/json' \
     -d '{"prompt":"textured crop with messy fringe"}' \
     http://localhost:5003/classify/text
```

Response contract:

```json
{
  "top1_style_id": "style_014_mohawk",
  "top1_confidence": 0.91,
  "topk": [["style_014_mohawk", 0.91], ["style_013_faux_hawk", 0.06], ["...", 0.02]]
}
```

When top-1 confidence < `ambiguous_threshold`, `top1_style_id` is
`"unknown_or_ambiguous"` and the caller should show the top-3 or fall back.

## Rebuild from scratch

### 1. Taxonomy sanity

```bash
pytest tests/test_taxonomy.py
```

Checks unique `style_id`s, ≥10 prompts per class, and hard-negative graph symmetry.

### 2. Pull datasets

**FaceSketches-HairStyle40** (Hugging Face, public):

```bash
export HF_TOKEN=hf_xxx  # optional, but recommended
.venv/bin/python -c "
from huggingface_hub import hf_hub_download
p = hf_hub_download(
    repo_id='trojblue/FaceSketches-HairStyle40',
    filename='FaceSketches-HairStyle40.zip',
    repo_type='dataset',
    local_dir='data/raw/hairstyle40',
)
print(p)
"
cd data/raw/hairstyle40 && unzip -q FaceSketches-HairStyle40.zip && mv FaceSketches-HairStyle40/image . && cd -
```

**Bing editorial scrape** (fills the 40→50 class gap and balances classes):

```bash
python scripts/scrape_editorial.py --per-class 80 --out data/raw/scraped
```

Tuned query strings per style_id live in `QUERY_OVERRIDES` inside
`scripts/scrape_editorial.py`. Portrait filter: `w/h ≤ 1.25`, `min_side ≥ 200`.
Expect ~30–90 min depending on network.

### 3. Ingest + map to taxonomy

```bash
python scripts/ingest_datasets.py
```

Reads every source folder, applies `taxonomy/taxonomy_map.json` (folder name →
`style_id`), writes `data/labels.csv` and `data/rejects.csv`. Scraped images
use the folder name directly as the `style_id` (no mapping needed).

### 4. Source-disjoint splits

```bash
python scripts/make_splits.py
```

SHA1-buckets each image path into train/val/test (80/10/10) so no image leaks
across splits. Outputs:
- `data/splits/train.csv`
- `data/splits/val.csv`
- `data/splits/test.csv`

```bash
pytest tests/test_dataset.py
```

Gates: no split overlap, every class has ≥N train samples, all labels exist in taxonomy.

### 5. Zero-shot baseline

```bash
python scripts/run_zero_shot.py --split val
```

Writes `outputs/reports/zero_shot.md`. If top-3 < 40% the taxonomy is confused — fix M1.

### 6. Linear probe

```bash
python scripts/run_linear_probe.py --epochs 50 --lr 1e-2
```

Caches backbone features once then trains only the head — ~100× faster than
re-encoding each epoch. **Head lr must be ≥1e-2** (features are L2-normalized,
gradients are tiny at lr=1e-4).

### 7. Fine-tune (CE + contrastive + WiSE-FT)

```bash
python scripts/run_fine_tune.py --config configs/fine_tune.yaml
```

Key details the config controls:

- `lr: 1.0e-5` — applied to the CLIP backbone
- Head and contrastive logit-scale get `100 × lr` internally (same L2-normalized-feature reason as the linear probe)
- `contrastive_weight: 0.5` — weighting on InfoNCE over sampled prompts
- `wise_ft_alpha: 0.5` — weight-space interp between zero-shot and fine-tuned backbones at inference
- `class_balanced_sampling: true` + `hard_negative_boost: 2.0` — oversamples confused pairs

Outputs:
- `outputs/checkpoints/fine_tune_latest.pt` — contains both fine-tuned and WiSE-FT backbone states, the CE head, and the contrastive logit scale
- `outputs/reports/fine_tune.md` — top-1 / top-3 / macro-F1, top-20 confused pairs

### 8. Hard-negative mining (optional retrain)

```bash
python scripts/mine_hard_negatives.py
```

Reads the last epoch's confusion matrix, re-writes `taxonomy/hard_negatives.json`,
then re-run fine-tune with the updated pair boosts.

### 9. Calibration

```bash
python scripts/run_calibration.py
```

Fits temperature scaling on val, then sweeps confident / ambiguous thresholds
to maximize expected utility. **Writes back into the checkpoint** — the
classifier picks them up automatically on next load:

```python
if "temperature" in ckpt:          self.temperature = float(ckpt["temperature"])
if "confident_threshold" in ckpt:  self.cfg.confident_threshold = float(...)
if "ambiguous_threshold" in ckpt:  self.cfg.ambiguous_threshold = float(...)
```

## Repo layout

```
haircut-classifier/
├── taxonomy/                 frozen taxonomy + prompt library
│   ├── taxonomy.json         50 style_ids + names + defs + attributes
│   ├── prompts.json          12 templates × 3-6 synonyms per class
│   ├── hard_negatives.json   explicit confused-pair graph
│   └── taxonomy_map.json     source folder name → style_id
├── data/
│   ├── raw/                  downloaded + scraped images (gitignored)
│   │   ├── hairstyle40/
│   │   └── scraped/
│   ├── labels.csv            image_path, style_id, source, ...
│   ├── rejects.csv           images not mappable to taxonomy
│   └── splits/               source-disjoint train/val/test CSVs
├── src/
│   ├── config.py             paths + TrainConfig + ServingConfig
│   ├── preprocess/           face_detect (skipped), hair_crop, ingest
│   ├── data/                 dataset, sampler, transforms
│   ├── models/               backbone (OpenCLIP), classifier, losses
│   ├── train/                zero_shot, linear_probe, fine_tune
│   ├── eval/                 metrics, confusion, calibration, report
│   ├── inference/predict.py  Classifier class + get_classifier singleton
│   └── api/classifier_server.py   FastAPI service
├── scripts/                  CLI entry points
├── configs/                  yaml overrides for TrainConfig
├── tests/                    pytest sanity gates
└── outputs/
    ├── checkpoints/fine_tune_latest.pt   trained weights + calibration
    └── reports/              zero_shot.md, fine_tune.md, final_eval.md
```

## Gotchas

- **Truncated images.** `src/data/dataset.py` sets `ImageFile.LOAD_TRUNCATED_IMAGES = True` and retries the next row on decode failure — scraped images aren't perfectly clean.
- **Label noise.** Spot-checks of test-set "misses" showed the model was often right and Bing's search label was wrong (e.g. `style_015_undercut/000074.jpg` that's actually a top knot). Don't trust the raw top-1 error rate literally.
- **MPS speed.** On Apple Silicon, 6 epochs of fine-tune takes ~30 min at `batch_size=64`. Bump both on CUDA.
- **Checkpoint path.** `ServingConfig.checkpoint` defaults to `outputs/checkpoints/fine_tune_latest.pt`. If you rename the file, either update the default or pass a custom `ServingConfig`.
- **Confident vs ambiguous threshold.** `confident=0.842` is deliberately high — below it, the API still returns the top-1 but the frontend should surface the top-3. Only below `ambiguous=0.421` does `top1_style_id` become `"unknown_or_ambiguous"`.

## Smoke test

```bash
pytest tests/
```

All 15 tests should pass (taxonomy + dataset + api).

```python
from src.inference.predict import Classifier
clf = Classifier()
for prompt in [
    "short textured crop with messy fringe",
    "high skin fade with long pompadour on top",
    "box braids in a high top knot",
    "classic buzz cut, very short and uniform",
]:
    r = clf.classify_text(prompt)
    print(f"{prompt:50s} -> {r['top1_style_id']} ({r['top1_confidence']:.2f})")
```

Expected: each prompt lands on the obvious class with confidence > 0.9.
