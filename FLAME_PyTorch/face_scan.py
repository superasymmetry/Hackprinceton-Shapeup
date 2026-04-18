"""
Real-time face scanning: webcam  →  iBUG-68 landmarks  →  FLAME fitting.

Uses face-alignment (Adrian Bulat) for landmark detection — it outputs the
same iBUG 68-point scheme that FLAME uses, so no remapping is needed.

Controls (webcam window)
------------------------
c  –  capture the current frame and fit FLAME to your face
q  –  quit

After fitting, a pyrender window opens with your personalised FLAME mesh.
Drag to rotate, scroll to zoom, q to close the viewer.
"""

import sys
import warnings
warnings.filterwarnings("ignore")

import cv2
import numpy as np
import torch
import trimesh
import pyrender
import face_alignment as _fa_module

from flame_pytorch import FLAME, get_config


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def make_landmark_detector(device):
    """Build a face_alignment detector on CPU (most stable across platforms)."""
    return _fa_module.FaceAlignment(
        _fa_module.LandmarksType.TWO_D,
        device="cpu",          # keep detection on CPU; FLAME forward runs on MPS
        flip_input=False,
    )


def detect_landmarks(bgr_frame, detector):
    """
    Run the landmark detector on a BGR OpenCV frame.
    Returns (68, 2) float32 pixel coords for the first face, or None.
    """
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    preds = detector.get_landmarks(rgb)
    if preds is None or len(preds) == 0:
        return None
    return preds[0].astype(np.float32)   # (68, 2)  —  iBUG 68 landmarks


# ---------------------------------------------------------------------------
# FLAME fitting  (weak-perspective camera, no calibration required)
# ---------------------------------------------------------------------------

def fit_flame(target_lmks_2d, flame_layer, device, n_iter=400):
    """
    Optimise FLAME shape / expression / pose so their weak-perspective
    projection matches the 2-D detected landmarks.

    Uses only the 51 stable static landmarks (iBUG 17-67).
    The jaw-contour points (0-16) shift with head rotation and are excluded.

    Returns
    -------
    vertices_np  : (V, 3)  float32 numpy  –  mesh vertices
    landmarks_np : (68, 3) float32 numpy  –  3-D landmark positions
    """
    target = torch.tensor(target_lmks_2d, dtype=torch.float32, device=device)

    # Optimisable FLAME parameters (neutral mean face at start)
    shape_params = torch.zeros(1, 100, device=device, requires_grad=True)
    expr_params  = torch.zeros(1,  50, device=device, requires_grad=True)
    pose_params  = torch.zeros(1,   6, device=device, requires_grad=True)

    # Weak-perspective camera: scale (px/m) + 2-D translation (px).
    # Bootstrap scale from the inter-eye pixel distance vs. FLAME's ~6 cm eye span.
    right_eye_outer = target_lmks_2d[36]
    left_eye_outer  = target_lmks_2d[45]
    eye_width_px    = float(np.linalg.norm(left_eye_outer - right_eye_outer))
    init_scale      = max(eye_width_px / 0.06, 50.0)

    scale = torch.tensor([init_scale], dtype=torch.float32,
                         device=device, requires_grad=True)
    tx    = torch.tensor([float(target_lmks_2d[:, 0].mean())],
                         dtype=torch.float32, device=device, requires_grad=True)
    ty    = torch.tensor([float(target_lmks_2d[:, 1].mean())],
                         dtype=torch.float32, device=device, requires_grad=True)

    neck_pose = torch.zeros(1, 3, device=device)
    eye_pose  = torch.zeros(1, 6, device=device)

    optimizer = torch.optim.Adam(
        [shape_params, expr_params, pose_params, scale, tx, ty],
        lr=0.02,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=n_iter
    )

    print("Fitting FLAME to your face …")
    for step in range(n_iter):
        optimizer.zero_grad()

        _, landmarks = flame_layer(
            shape_params, expr_params, pose_params, neck_pose, eye_pose
        )
        lmk3d = landmarks[0]   # (68, 3)

        # Weak-perspective projection.
        # FLAME: +Y is up.  Image: +Y is down.  → negate Y.
        px = scale * lmk3d[:, 0] + tx
        py = -scale * lmk3d[:, 1] + ty
        proj = torch.stack([px, py], dim=1)   # (68, 2)

        # Loss on stable static landmarks only (iBUG 17-67)
        loss = torch.mean((proj[17:] - target[17:]) ** 2)

        # Regularisation: keep params near neutral
        loss = loss + 1e-4 * (shape_params ** 2).sum()
        loss = loss + 1e-4 * (expr_params  ** 2).sum()
        loss = loss + 1e-3 * (pose_params  ** 2).sum()

        loss.backward()
        optimizer.step()
        scheduler.step()

        if (step + 1) % 100 == 0:
            print(f"  step {step + 1:3d}/{n_iter}  loss = {loss.item():.4f}")

    # Final forward pass for the complete mesh
    with torch.no_grad():
        vertices, landmarks = flame_layer(
            shape_params, expr_params, pose_params, neck_pose, eye_pose
        )
    return vertices[0].cpu().numpy(), landmarks[0].cpu().numpy()


# ---------------------------------------------------------------------------
# Visualisation
# ---------------------------------------------------------------------------

def save_mesh(vertices, faces, path="flame_result.obj"):
    """Save the fitted mesh to an OBJ file."""
    tri_mesh = trimesh.Trimesh(vertices, faces)
    tri_mesh.export(path)
    print(f"Mesh saved → {path}")


def show_fitted_mesh(vertices, landmarks, faces):
    """Open an interactive pyrender window with the fitted FLAME mesh."""
    vertex_colors = np.ones([vertices.shape[0], 4]) * [0.80, 0.65, 0.55, 1.0]
    tri_mesh = trimesh.Trimesh(vertices, faces, vertex_colors=vertex_colors)
    mesh = pyrender.Mesh.from_trimesh(tri_mesh)

    sm = trimesh.creation.uv_sphere(radius=0.004)
    sm.visual.vertex_colors = [0.9, 0.1, 0.1, 1.0]
    tfs = np.tile(np.eye(4), (len(landmarks), 1, 1))
    tfs[:, :3, 3] = landmarks
    landmark_pcl = pyrender.Mesh.from_trimesh(sm, poses=tfs)

    scene = pyrender.Scene()
    scene.add(mesh)
    scene.add(landmark_pcl)

    print("\nShowing fitted FLAME model.")
    print("  Drag to rotate  |  Scroll to zoom  |  q to close\n")
    pyrender.Viewer(scene, use_raymond_lighting=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    device = get_device()
    print(f"Using device: {device}")

    # ── Load FLAME (batch_size=1 for single-face fitting) ──────────────────
    config = get_config()
    config.batch_size = 1
    flame_layer = FLAME(config).to(device)
    flame_layer.eval()
    faces = flame_layer.faces

    # ── Build landmark detector (downloads weights on first run, ~90 MB) ───
    print("Loading face landmark detector …")
    detector = make_landmark_detector(device)
    print("Detector ready.\n")

    # ── Open webcam ─────────────────────────────────────────────────────────
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: could not open webcam (device 0).")
        sys.exit(1)

    print("Webcam ready.")
    print("  Look straight at the camera, then press 'c' to capture.")
    print("  Press 'q' to quit.\n")

    captured_lmks = None

    # We run the detector only every N frames to keep the preview smooth.
    detect_every = 5
    frame_idx    = 0
    last_lmks    = None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.flip(frame, 1)   # mirror so it feels natural

        if frame_idx % detect_every == 0:
            last_lmks = detect_landmarks(frame, detector)
        frame_idx += 1

        display = frame.copy()
        if last_lmks is not None:
            for (x, y) in last_lmks.astype(int):
                cv2.circle(display, (x, y), 2, (0, 220, 60), -1)
            cv2.putText(
                display,
                "Face detected  —  press 'c' to fit FLAME",
                (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 220, 60), 2,
            )
        else:
            cv2.putText(
                display,
                "No face detected  —  centre your face in the frame",
                (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 80, 220), 2,
            )

        cv2.imshow("FLAME Face Scanner  |  c = capture   q = quit", display)
        key = cv2.waitKey(1) & 0xFF

        if key == ord("q"):
            break
        elif key == ord("c") and last_lmks is not None:
            # Re-detect on the exact capture frame for best accuracy
            captured_lmks = detect_landmarks(frame, detector)
            if captured_lmks is None:
                print("Detection failed on capture frame — try again.")
            else:
                break

    cap.release()
    cv2.destroyAllWindows()

    if captured_lmks is not None:
        vertices, landmarks = fit_flame(captured_lmks, flame_layer, device)
        save_mesh(vertices, faces)
        show_fitted_mesh(vertices, landmarks, faces)


if __name__ == "__main__":
    main()
