"""Central paths and hyperparameter defaults."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TAXONOMY_DIR = ROOT / "taxonomy"
TAXONOMY_JSON = TAXONOMY_DIR / "taxonomy.json"
PROMPTS_JSON = TAXONOMY_DIR / "prompts.json"
HARD_NEGATIVES_JSON = TAXONOMY_DIR / "hard_negatives.json"
TAXONOMY_MAP_JSON = TAXONOMY_DIR / "taxonomy_map.json"

DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
IMAGES_DIR = DATA_DIR / "images"
LABELS_CSV = DATA_DIR / "labels.csv"
REJECTS_CSV = DATA_DIR / "rejects.csv"
SPLITS_DIR = DATA_DIR / "splits"

OUTPUTS_DIR = ROOT / "outputs"
CHECKPOINTS_DIR = OUTPUTS_DIR / "checkpoints"
LOGS_DIR = OUTPUTS_DIR / "logs"
REPORTS_DIR = OUTPUTS_DIR / "reports"


@dataclass
class TrainConfig:
    backbone: str = "ViT-B-32"
    pretrained: str = "laion2b_s34b_b79k"
    image_size: int = 224
    batch_size: int = 128
    epochs: int = 20
    lr: float = 1e-4
    weight_decay: float = 0.1
    warmup_steps: int = 500
    contrastive_weight: float = 0.5  # λ in L_CE + λ·L_contrastive
    wise_ft_alpha: float = 0.5       # weight-space interp at inference
    seed: int = 0
    class_balanced_sampling: bool = True
    hard_negative_boost: float = 2.0  # multiplier for confused-pair oversampling


@dataclass
class ServingConfig:
    port: int = 5003
    checkpoint: str = "outputs/checkpoints/fine_tune_latest.pt"
    top_k: int = 3
    # Thresholds chosen on val via eval/calibration.py
    confident_threshold: float = 0.55
    ambiguous_threshold: float = 0.30
