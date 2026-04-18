"""
Lightweight FLAME alignment server.

Uses face-alignment (68 3D landmark detector, ~0.3s on CPU) + FLAME_PyTorch
to fit a parametric face mesh to a photo. Returns FLAME vertices + the
Procrustes transform that maps FLAME canonical → image space, so the
Three.js scene can overlay the wireframe mesh and co-register FaceLift
Gaussians and HairStep strands to the same FLAME frame.

Setup:
    pip install face-alignment flask numpy pillow

Run (from repo root or server/ dir):
    python server/smirk_server.py

Expose via ngrok:
    ngrok http 5003
Then set SMIRK_URL in .env.local.
"""

import io
import sys
from pathlib import Path

import numpy as np
import torch
from flask import Flask, jsonify, request
from PIL import Image

FLAME_DIR = str(Path(__file__).parent.parent / "FLAME_PyTorch")
sys.path.insert(0, FLAME_DIR)

app = Flask(__name__)

_fa    = None
_flame = None


def _get_fa():
    global _fa
    if _fa is None:
        import face_alignment
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _fa = face_alignment.FaceAlignment(
            face_alignment.LandmarksType.THREE_D, device=device
        )
    return _fa


def _get_flame():
    global _flame
    if _flame is None:
        from flame_pytorch import FLAME, get_config
        config = get_config()
        config.batch_size = 1
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _flame = FLAME(config).to(device)
        _flame.eval()
    return _flame


def _flame_neutral():
    """Return (vertices_np, landmarks_np, faces) for the FLAME neutral mesh."""
    flame = _get_flame()
    device = next(flame.parameters()).device
    with torch.no_grad():
        shape = torch.zeros(1, 100, device=device)
        expr  = torch.zeros(1, 50,  device=device)
        pose  = torch.zeros(1, 6,   device=device)
        neck  = torch.zeros(1, 3,   device=device)
        eye   = torch.zeros(1, 6,   device=device)
        verts, lmks = flame(shape, expr, pose, neck, eye)
    return verts[0].cpu().numpy(), lmks[0].cpu().numpy(), flame.faces


def _procrustes(source: np.ndarray, target: np.ndarray):
    """
    Similarity transform (scale, R, t) such that scale * R @ source.T + t ≈ target.T.

    source, target: (N, 3)
    Returns: scale (float), R (3×3), t (3,)
    """
    s_mean = source.mean(0)
    t_mean = target.mean(0)
    s = source - s_mean
    t = target - t_mean

    s_scale = np.sqrt((s ** 2).sum(1).mean())
    t_scale = np.sqrt((t ** 2).sum(1).mean())
    scale   = t_scale / max(s_scale, 1e-8)

    s_n = s / max(s_scale, 1e-8)
    t_n = t / max(t_scale, 1e-8)

    H = s_n.T @ t_n
    U, _, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T
    if np.linalg.det(R) < 0:
        Vt[-1] *= -1
        R = Vt.T @ U.T

    t_vec = t_mean - scale * R @ s_mean
    return scale, R, t_vec


@app.route("/align", methods=["POST"])
def align():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    img_pil = Image.open(request.files["image"]).convert("RGB")
    img_np  = np.array(img_pil)

    fa = _get_fa()
    detections = fa.get_landmarks(img_np)
    if not detections:
        return jsonify({"error": "No face detected"}), 422

    # face_alignment returns (68, 3): x_px, y_px, z_depth
    lmks_2d5d = detections[0]            # (68, 3), image coords

    verts_canonical, flame_lmks, faces = _flame_neutral()
    # verts_canonical: (5023, 3), FLAME space (~0.1 m scale)
    # flame_lmks:      (68,   3), FLAME space

    # Align FLAME landmarks → detected image-space landmarks
    scale, R, t = _procrustes(flame_lmks, lmks_2d5d)

    # Apply transform to get FLAME verts in image space
    aligned_verts = (scale * (R @ verts_canonical.T).T) + t   # (5023, 3)
    aligned_lmks  = (scale * (R @ flame_lmks.T).T)    + t     # (68,   3)

    return jsonify({
        # Canonical FLAME mesh (scale ~0.1 m) — frontend multiplies by 10 → scene units
        "vertices_canonical": verts_canonical.tolist(),
        "faces":              faces.tolist(),
        "landmarks_canonical": flame_lmks.tolist(),

        # Image-space aligned versions (for co-registration with FaceLift / HairStep)
        "vertices_aligned":  aligned_verts.tolist(),
        "landmarks_aligned": aligned_lmks.tolist(),

        # Raw Procrustes transform (scale, R 3×3, t 3-vector)
        "transform": {
            "scale":       float(scale),
            "rotation":    R.tolist(),
            "translation": t.tolist(),
        },

        # 2D+depth landmarks as detected (for optional canvas overlay)
        "detected_landmarks": lmks_2d5d.tolist(),
    })


if __name__ == "__main__":
    print("[smirk_server] Pre-loading models…")
    _get_fa()
    _get_flame()
    print("[smirk_server] Ready on :5003")
    app.run(host="0.0.0.0", port=5003, threaded=True)
