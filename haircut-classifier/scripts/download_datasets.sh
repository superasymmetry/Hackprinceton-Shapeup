#!/usr/bin/env bash
# Download and unpack the three source datasets into data/raw/.
# Only CelebAMask-HQ downloads fully non-interactively. K-Hairstyle requires a
# manual request form; Hairstyle30k lives in Chinese mirrors or author contact.
# This script prints the next manual step rather than silently failing.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/data/raw"
mkdir -p "$RAW"

echo "==> haircut-classifier dataset bootstrap"
echo "    data root: $RAW"
echo

# ------------------------------------------------------------------
# 1. CelebAMask-HQ  (hair segmentation, 30k images, automatic)
# ------------------------------------------------------------------
CM_DIR="$RAW/celebamask_hq"
if [ ! -d "$CM_DIR/CelebAMask-HQ" ]; then
    echo "[1/3] CelebAMask-HQ"
    mkdir -p "$CM_DIR"
    echo "      Downloading from Hugging Face mirror…"
    # Hugging Face mirrors the dataset as a single archive. Replace with an
    # authenticated URL if you hit rate limits.
    # Official Google Drive link (from switchablenorms/CelebAMask-HQ) requires
    # a captcha; we use the HF mirror instead.
    python -c "from huggingface_hub import snapshot_download; \
snapshot_download('liusq/CelebAMask-HQ', repo_type='dataset', \
local_dir='$CM_DIR', local_dir_use_symlinks=False)"
    echo "      done: $CM_DIR"
else
    echo "[1/3] CelebAMask-HQ — already present, skipping."
fi
echo

# ------------------------------------------------------------------
# 2. Hairstyle30k  (64 classes, 30k images, scraped — label-noisy)
# ------------------------------------------------------------------
HS_DIR="$RAW/hairstyle30k"
if [ ! -d "$HS_DIR" ] || [ -z "$(ls -A "$HS_DIR" 2>/dev/null)" ]; then
    echo "[2/3] Hairstyle30k"
    mkdir -p "$HS_DIR"
    cat <<'MSG'
      Hairstyle30k is NOT on a single public mirror. Options:
       a) Email the authors (Yin Weidong / Fu Yanwei, Fudan) citing the paper
          "Learning to Generate and Edit Hairstyles" (ACM MM 2017).
          Paper: https://yanweifu.github.io/papers/hairstyle_v_14_weidong.pdf
       b) Check the Baidu Pan mirror linked from their GitHub releases.
       c) Use the 10-class simplified variant cited by CelebHair:
          https://github.com/reacher-z/CelebHair

      Once obtained, unpack into:
          haircut-classifier/data/raw/hairstyle30k/
      with the top level containing one folder per class name.
MSG
else
    echo "[2/3] Hairstyle30k — directory is populated, skipping."
fi
echo

# ------------------------------------------------------------------
# 3. K-Hairstyle  (500k images, 31 classes, request form required)
# ------------------------------------------------------------------
KH_DIR="$RAW/k_hairstyle"
if [ ! -d "$KH_DIR" ] || [ -z "$(ls -A "$KH_DIR" 2>/dev/null)" ]; then
    echo "[3/3] K-Hairstyle"
    mkdir -p "$KH_DIR"
    cat <<'MSG'
      K-Hairstyle is distributed by request. Steps:
       1. Visit https://psh01087.github.io/K-Hairstyle/
       2. Fill out the agreement form; they reply with download URLs.
       3. Choose the mqset (512x512) tier unless you need higher resolution.
       4. Unpack into:
              haircut-classifier/data/raw/k_hairstyle/
          keeping their {images/, masks/, labels.json} layout intact.
       5. Then populate taxonomy/taxonomy_map.json -> "k_hairstyle" block
          with the actual class names from their release.
MSG
else
    echo "[3/3] K-Hairstyle — directory is populated, skipping."
fi
echo

echo "==> Bootstrap complete. Next: run"
echo "       python scripts/ingest_datasets.py"
echo "    to apply taxonomy_map.json and emit data/labels.csv."
