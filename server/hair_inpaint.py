"""
Mask-constrained hair inpainting pipeline.

Steps:
  1. jonathandinu/face-parsing (SegFormer) → per-pixel hair mask
  2. Dilate mask by DILATION_PX to catch stray edge pixels
  3. OpenCV Telea inpainting propagates skin pixels from hairline inward
     (fast, offline, no model download required)
  4. Composite: inpainted result pasted over original; face pixels are never touched

Because the face region is pixel-identical to the original, MediaPipe / FLAME
landmark checks will not drift, eliminating the reject-and-retry loop.
"""

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

# jonathandinu/face-parsing: hair = 13 (not 17 as in vanilla CelebAMask-HQ)
_HAIR_LABEL = 13

DILATION_PX = 8

_face_parser_cache: tuple | None = None


def _face_parser():
    global _face_parser_cache
    if _face_parser_cache is None:
        proc  = SegformerImageProcessor.from_pretrained("jonathandinu/face-parsing")
        model = SegformerForSemanticSegmentation.from_pretrained("jonathandinu/face-parsing")
        model.eval()
        _face_parser_cache = (proc, model)
    return _face_parser_cache


def _hair_mask(image: Image.Image) -> np.ndarray:
    """Binary uint8 mask (255 = hair) at original image resolution."""
    proc, model = _face_parser()
    inputs = proc(images=image, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits          # (1, C, H/4, W/4)
    upsampled = torch.nn.functional.interpolate(
        logits,
        size=(image.height, image.width),
        mode="bilinear",
        align_corners=False,
    )
    seg = upsampled.argmax(dim=1).squeeze().numpy().astype(np.uint8)
    return (seg == _HAIR_LABEL).astype(np.uint8) * 255


def _dilate(mask: np.ndarray, px: int) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(mask, kernel)


def _sample_skin_tone(img_rgb: np.ndarray, seg: np.ndarray, skin_label: int = 1) -> np.ndarray:
    """Return median BGR color of skin-labeled pixels."""
    skin_px = img_rgb[seg == skin_label]
    if len(skin_px) == 0:
        return np.array([180, 150, 130], dtype=np.uint8)
    return np.median(skin_px, axis=0).astype(np.uint8)


def inpaint_hair(image_path: str, output_path: str, device: torch.device | None = None) -> str:
    """
    Removes hair via a two-pass approach:
      1. Pre-fill hair region with sampled skin tone so Telea never pulls background.
      2. Telea inpaint a thin border band for smooth edge blending.
    Face pixels are byte-identical to the original.
    """
    proc, model = _face_parser()

    orig    = Image.open(image_path).convert("RGB")
    W, H    = orig.size
    img_rgb = np.array(orig)

    # --- segmentation ---
    inputs = proc(images=orig, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits
    up  = torch.nn.functional.interpolate(logits, size=(H, W), mode="bilinear", align_corners=False)
    seg = up.argmax(dim=1).squeeze().numpy().astype(np.uint8)

    hair_mask = (seg == _HAIR_LABEL).astype(np.uint8) * 255
    hair_mask = _dilate(hair_mask, DILATION_PX)

    if hair_mask.max() == 0:
        Image.fromarray(img_rgb).save(output_path)
        return output_path

    # --- pass 1: flood-fill hair region with median skin tone ---
    skin_rgb  = _sample_skin_tone(img_rgb, seg)
    prefilled = img_rgb.copy()
    prefilled[hair_mask > 0] = skin_rgb

    # --- pass 2: Telea on a thin edge band (erode mask, inpaint border only) ---
    kernel_sm  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    inner_mask = cv2.erode(hair_mask, kernel_sm, iterations=3)
    edge_mask  = cv2.subtract(hair_mask, inner_mask)   # thin ring at boundary

    img_bgr   = cv2.cvtColor(prefilled, cv2.COLOR_RGB2BGR)
    blended   = cv2.inpaint(img_bgr, edge_mask, inpaintRadius=10, flags=cv2.INPAINT_TELEA)
    result_rgb = cv2.cvtColor(blended, cv2.COLOR_BGR2RGB)

    # Feather the hair mask for a soft composite
    feather    = cv2.GaussianBlur(hair_mask.astype(np.float32), (21, 21), 0) / 255.0
    alpha      = feather[:, :, np.newaxis]
    composite  = (result_rgb * alpha + img_rgb * (1 - alpha)).astype(np.uint8)

    Image.fromarray(composite).save(output_path)
    return output_path


if __name__ == "__main__":
    import sys
    from pathlib import Path

    if len(sys.argv) < 2:
        print("Usage: python hair_inpaint.py <image> [output_dir]")
        sys.exit(1)

    src = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else src.parent / "baldified"
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / f"{src.stem}_bald{src.suffix}"

    print(f"Input:  {src}")
    print(f"Output: {dst}")
    inpaint_hair(str(src), str(dst))
    print("Done.")
