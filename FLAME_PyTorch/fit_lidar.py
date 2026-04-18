"""
Fit FLAME to an iPhone LiDAR scan (OBJ or PLY point cloud).

Usage:
    python3 fit_lidar.py path/to/scan.obj
    python3 fit_lidar.py path/to/scan.ply

Pipeline:
    1. Load the scanned point cloud / mesh
    2. Roughly align it to FLAME's coordinate system (centre + scale)
    3. Optimise FLAME shape / expression / pose using Chamfer distance
    4. Save result as flame_lidar_result.obj and print scale/offset for Three.js

No camera calibration needed — works purely in 3D.
"""

import sys
import warnings
warnings.filterwarnings("ignore")

import numpy as np
import torch
import trimesh

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


def load_point_cloud(path: str, n_points: int = 5000) -> np.ndarray:
    """
    Load OBJ or PLY scan, return (N, 3) float32 point cloud.
    Downsamples to n_points for speed.
    """
    mesh = trimesh.load(path, force="mesh", process=False)

    if hasattr(mesh, "vertices") and len(mesh.vertices) > 0:
        pts = np.array(mesh.vertices, dtype=np.float32)
    else:
        raise ValueError(f"Could not load point cloud from {path}")

    print(f"Loaded {len(pts)} points from {path}")

    # Subsample
    if len(pts) > n_points:
        idx = np.random.choice(len(pts), n_points, replace=False)
        pts = pts[idx]

    return pts


def normalize_to_flame(pts: np.ndarray):
    """
    Centre the scan at the origin and scale so the bounding-box height
    matches FLAME's neutral face (~0.22 m ear-to-chin).
    Returns (normalised_pts, centre, scale) so we can invert later.
    """
    centre = pts.mean(axis=0)
    pts_c  = pts - centre

    # Estimate face height from Y extent
    y_range = pts_c[:, 1].max() - pts_c[:, 1].min()
    flame_face_height = 0.22          # metres in FLAME coordinate space
    scale = flame_face_height / max(y_range, 1e-6)

    return pts_c * scale, centre, scale


# ---------------------------------------------------------------------------
# Chamfer distance (one-directional: scan → FLAME mesh)
# ---------------------------------------------------------------------------

def chamfer_scan_to_flame(scan_pts: torch.Tensor, flame_verts: torch.Tensor):
    """
    For every point in scan_pts, find the nearest FLAME vertex.
    Returns mean squared distance.

    scan_pts   : (N, 3)
    flame_verts: (V, 3)
    """
    # (N, 1, 3) - (1, V, 3) → (N, V, 3) → (N, V)
    diff = scan_pts.unsqueeze(1) - flame_verts.unsqueeze(0)
    dist2 = (diff ** 2).sum(dim=2)           # (N, V)
    min_dist2 = dist2.min(dim=1).values      # (N,)
    return min_dist2.mean()


# ---------------------------------------------------------------------------
# FLAME fitting
# ---------------------------------------------------------------------------

def fit_flame_to_lidar(scan_pts_np: np.ndarray, flame_layer, device,
                       n_iter: int = 600):
    """
    Optimise FLAME shape / expression / pose to minimise Chamfer distance
    to the input LiDAR point cloud.

    Returns (vertices_np, faces)
    """
    scan_pts = torch.tensor(scan_pts_np, dtype=torch.float32, device=device)

    shape_params = torch.zeros(1, 100, device=device, requires_grad=True)
    expr_params  = torch.zeros(1,  50, device=device, requires_grad=True)
    pose_params  = torch.zeros(1,   6, device=device, requires_grad=True)
    neck_pose    = torch.zeros(1,   3, device=device)
    eye_pose     = torch.zeros(1,   6, device=device)

    optimizer = torch.optim.Adam(
        [shape_params, expr_params, pose_params],
        lr=0.01,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=n_iter)

    print(f"Fitting FLAME to LiDAR scan ({len(scan_pts_np)} points, {n_iter} iters) …")
    for step in range(n_iter):
        optimizer.zero_grad()

        vertices, _ = flame_layer(shape_params, expr_params, pose_params,
                                  neck_pose, eye_pose)
        verts = vertices[0]   # (5023, 3)

        loss = chamfer_scan_to_flame(scan_pts, verts)

        # Regularise — keep parameters near neutral
        loss = loss + 1e-4 * (shape_params ** 2).sum()
        loss = loss + 1e-4 * (expr_params  ** 2).sum()
        loss = loss + 1e-3 * (pose_params  ** 2).sum()

        loss.backward()
        optimizer.step()
        scheduler.step()

        if (step + 1) % 100 == 0:
            print(f"  step {step + 1:3d}/{n_iter}  chamfer = {loss.item():.6f}")

    with torch.no_grad():
        vertices, _ = flame_layer(shape_params, expr_params, pose_params,
                                  neck_pose, eye_pose)

    return vertices[0].cpu().numpy(), flame_layer.faces


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fit_lidar.py <scan.obj|scan.ply>")
        sys.exit(1)

    scan_path = sys.argv[1]
    device    = get_device()
    print(f"Device: {device}")

    # ── Load FLAME ─────────────────────────────────────────────────────────
    config = get_config()
    config.batch_size = 1
    flame_layer = FLAME(config).to(device)
    flame_layer.eval()

    # ── Load + normalise scan ───────────────────────────────────────────────
    pts_raw              = load_point_cloud(scan_path)
    pts_norm, centre, scale = normalize_to_flame(pts_raw)

    print(f"Scan centre: {centre.round(4)}  scale factor: {scale:.4f}")

    # ── Fit ─────────────────────────────────────────────────────────────────
    verts_flame, faces = fit_flame_to_lidar(pts_norm, flame_layer, device)

    # ── Save result ─────────────────────────────────────────────────────────
    out_path = "flame_lidar_result.obj"
    tri_mesh = trimesh.Trimesh(verts_flame, faces)
    tri_mesh.export(out_path)
    print(f"\nMesh saved → {out_path}")

    # Print the transform needed to align this back to original scan space
    # (useful for aligning with HairStep output)
    print(f"\n── Alignment info (for Three.js / HairStep overlay) ──")
    print(f"  FLAME coord → original scan coord:")
    print(f"    scale:  {1.0 / scale:.4f}  (multiply FLAME verts by this)")
    print(f"    offset: {centre.round(4)}  (then add this)")

    # ── Visualise ───────────────────────────────────────────────────────────
    try:
        import pyrender
        vertex_colors = np.ones([verts_flame.shape[0], 4]) * [0.80, 0.65, 0.55, 1.0]
        render_mesh = trimesh.Trimesh(verts_flame, faces, vertex_colors=vertex_colors)
        scene = pyrender.Scene()
        scene.add(pyrender.Mesh.from_trimesh(render_mesh))

        # Also show the scan point cloud in blue
        sm = trimesh.creation.uv_sphere(radius=0.001)
        sm.visual.vertex_colors = [0.2, 0.4, 0.9, 0.5]
        tfs = np.tile(np.eye(4), (len(pts_norm), 1, 1))
        tfs[:, :3, 3] = pts_norm
        scene.add(pyrender.Mesh.from_trimesh(sm, poses=tfs))

        print("\nBlue = your LiDAR scan   |   Skin = FLAME fit")
        print("Drag to rotate  |  Scroll to zoom  |  q to close")
        pyrender.Viewer(scene, use_raymond_lighting=True)
    except Exception as e:
        print(f"(Viewer skipped: {e})")


if __name__ == "__main__":
    main()
