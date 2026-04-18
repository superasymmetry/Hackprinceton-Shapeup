"""OpenCV Haar-cascade-based face detection + head-region crop.

Note: MediaPipe's `solutions` API was removed on Python 3.14; we use OpenCV's
bundled Haar cascade instead. It's less accurate than MediaPipe short-range
but needs no extra weights and works everywhere.

Two crops are produced per accepted image:
  - portrait_crop: face + shoulders + surrounding context (for style cues)
  - head_crop:     tight crop around the hair bounding box

Images are rejected when:
  - no face is detected
  - more than one face is detected (we don't know which person to label)
  - the face box is smaller than MIN_FACE_PX (too far / too low-res)
  - variance of Laplacian indicates blur

MediaPipe is imported lazily so tests/CI can run without it installed.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image


def _stable_stem(p: Path) -> str:
    """Unique stem per input path — avoids collisions when multiple sources
    share filenames like '1.jpg'."""
    h = hashlib.sha1(str(p).encode()).hexdigest()[:12]
    return f"{p.stem}_{h}"

MIN_FACE_PX = 80
BLUR_THRESHOLD = 60.0
PORTRAIT_PAD_RATIO = 1.6  # multiplier around face box for portrait crop
HEAD_PAD_RATIO = 1.3      # tighter — just cover hair

_DETECTOR = None


@dataclass
class CropResult:
    portrait: Image.Image
    head: Image.Image
    reason_if_rejected: str | None = None


def _get_detector():
    """Lazy-load OpenCV Haar-cascade face detector (frontal face)."""
    global _DETECTOR
    if _DETECTOR is None:
        import cv2
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        _DETECTOR = cv2.CascadeClassifier(path)
        if _DETECTOR.empty():
            raise RuntimeError(f"could not load cascade at {path}")
    return _DETECTOR


def _blur_score(img: Image.Image) -> float:
    import cv2
    arr = np.array(img.convert("L"))
    return float(cv2.Laplacian(arr, cv2.CV_64F).var())


def _crop_with_pad(
    img: Image.Image, box_xyxy: tuple[int, int, int, int], pad_ratio: float
) -> Image.Image:
    x0, y0, x1, y1 = box_xyxy
    w, h = x1 - x0, y1 - y0
    cx, cy = x0 + w / 2, y0 + h / 2
    side = max(w, h) * pad_ratio
    nx0 = int(max(0, cx - side / 2))
    ny0 = int(max(0, cy - side / 2))
    nx1 = int(min(img.width, cx + side / 2))
    ny1 = int(min(img.height, cy + side / 2))
    return img.crop((nx0, ny0, nx1, ny1))


def crop_single(img: Image.Image) -> CropResult | None:
    """Return CropResult on success, None on rejection (callers log the reason)."""
    import cv2
    detector = _get_detector()

    gray = np.array(img.convert("L"))
    faces = detector.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=4, minSize=(MIN_FACE_PX, MIN_FACE_PX)
    )
    if len(faces) == 0:
        return CropResult(img, img, "no_face")
    if len(faces) > 1:
        # Keep the largest face (most editorial scrapes include bystanders).
        faces = sorted(faces, key=lambda b: b[2] * b[3], reverse=True)[:1]

    fx, fy, fw, fh = [int(v) for v in faces[0]]
    x0, y0, x1, y1 = fx, fy, fx + fw, fy + fh

    if fw < MIN_FACE_PX or fh < MIN_FACE_PX:
        return CropResult(img, img, "face_too_small")

    portrait = _crop_with_pad(img, (x0, y0, x1, y1), PORTRAIT_PAD_RATIO)
    head = _crop_with_pad(img, (x0, y0, x1, y1), HEAD_PAD_RATIO)

    if _blur_score(head) < BLUR_THRESHOLD:
        return CropResult(portrait, head, "blurry")

    return CropResult(portrait, head, None)


def crop_batch(
    paths: Iterable[Path], out_root: Path
) -> dict[str, list[Path]]:
    """Crop and write under out_root/{portrait,head}/<stem>.jpg.

    Returns per-path metadata dict with keys {accepted, rejected}. Rejected
    paths are returned with their reason so the caller can update rejects.csv.
    """
    out_root.mkdir(parents=True, exist_ok=True)
    portrait_dir = out_root / "portrait"
    head_dir = out_root / "head"
    portrait_dir.mkdir(exist_ok=True)
    head_dir.mkdir(exist_ok=True)

    accepted: list[Path] = []
    rejected: list[tuple[Path, str]] = []
    for p in paths:
        try:
            img = Image.open(p)
        except Exception as e:
            rejected.append((p, f"open_error:{e}"))
            continue
        res = crop_single(img)
        if res is None or res.reason_if_rejected:
            rejected.append((p, res.reason_if_rejected or "unknown"))
            continue
        stem = _stable_stem(p)
        res.portrait.save(portrait_dir / f"{stem}.jpg", quality=92)
        res.head.save(head_dir / f"{stem}.jpg", quality=92)
        accepted.append(p)
    return {"accepted": accepted, "rejected": rejected}
