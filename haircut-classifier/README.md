# haircut-classifier

Closed-set haircut classifier for the ShapeUp app. Maps either an image or a
text prompt to one of 50 vetted `style_id`s from a frozen taxonomy.

Replaces free-form LLM haircut naming (which hallucinates specific cuts) with a
CLIP-family classifier constrained to known styles.

## Layout

```
taxonomy/      frozen style taxonomy + prompt library + hard-negative graph
data/          raw datasets + preprocessed crops + split CSVs (gitignored)
src/           preprocessing, data loaders, models, training, eval, inference, api
scripts/       one-shot utilities (download, train runs, hard-neg mining, serve)
configs/       yaml configs for each training run
tests/         pytest sanity tests for taxonomy, dataset splits, api contract
outputs/       checkpoints, logs, reports (gitignored except reports/.gitkeep)
```

## Quick start

```bash
cd haircut-classifier
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# M1 — sanity-check the frozen taxonomy
pytest tests/test_taxonomy.py

# M2 — build labels from FaceSketches-HairStyle40 + scraped folders
python scripts/ingest_datasets.py
python scripts/make_splits.py

# M4 — zero-shot baseline, no training required
python scripts/run_zero_shot.py --split val

# M5 — fine-tune
python scripts/run_fine_tune.py --config configs/fine_tune.yaml

# M7 — calibrate the actual serving path
python scripts/run_calibration.py

# M8 — serve
uvicorn src.api.classifier_server:app --host 0.0.0.0 --port 5003
```

## Contract

The serving API returns:

```json
{
  "top1_style_id": "style_014_french_crop",
  "top1_confidence": 0.82,
  "topk": [
    ["style_014_french_crop", 0.82],
    ["style_013_textured_crop", 0.11],
    ["style_005_caesar", 0.04]
  ]
}
```

When top-1 confidence is below the calibrated threshold, `top1_style_id` is
`"unknown_or_ambiguous"` and the caller is expected to show the top-3 to the
user or fall back to a broader category.

## Datasets used

Primary labeled sources in the repo are FaceSketches-HairStyle40 plus the
editorial scrape written under `data/raw/scraped/`. Optional preprocessing via
`src/preprocess/hair_crop.py` uses OpenCV, not MediaPipe.
