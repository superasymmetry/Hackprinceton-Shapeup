#!/usr/bin/env python3
"""
View a HairStep-style binary PLY (float64 vertices + int32 edges) with Open3D.

Matches the layout parsed in src/lib/parsePLY.ts — not a triangle mesh.

Usage:
  # Open3D needs Python 3.10–3.12 today (no wheels for 3.14+).
  python3.12 -m venv .venv
  source .venv/bin/activate
  pip install open3d numpy
  python scripts/view_hair_ply.py [path/to/file.ply]

Default path: public/hair/brunohair.ply (relative to repo root).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np

try:
    import open3d as o3d
except ImportError as e:
    raise SystemExit(
        "open3d is required: pip install open3d\n"
        "(numpy is also required: pip install numpy)"
    ) from e


def load_hairstep_ply(path: Path) -> tuple[np.ndarray, np.ndarray]:
    raw = path.read_bytes()
    marker = b"end_header\n"
    try:
        hdr_end = raw.index(marker) + len(marker)
    except ValueError as err:
        raise ValueError(f"No {marker!r} found in {path}") from err

    header = raw[:hdr_end].decode("ascii")
    m_v = re.search(r"element vertex (\d+)", header)
    m_e = re.search(r"element edge (\d+)", header)
    if not m_v:
        raise ValueError(f"No element vertex count in PLY header: {path}")
    n_verts = int(m_v.group(1))
    n_edges = int(m_e.group(1)) if m_e else 0

    body = memoryview(raw)[hdr_end:]
    need = n_verts * 24 + n_edges * 8
    if len(body) < need:
        raise ValueError(
            f"{path}: body too short: need {need} bytes after header, got {len(body)}"
        )

    verts = np.frombuffer(body, dtype="<f8", count=n_verts * 3).reshape(n_verts, 3)
    off = n_verts * 24
    if n_edges > 0:
        edges = np.frombuffer(body[off:], dtype="<i4", count=n_edges * 2).reshape(
            n_edges, 2
        )
    else:
        edges = np.zeros((0, 2), dtype=np.int32)

    # Open3D rejects read-only buffers from np.frombuffer
    verts = np.copy(verts)
    edges = np.copy(edges)

    print(f"[view_hair_ply] {n_verts} vertices, {n_edges} edges")
    bmin = verts.min(axis=0)
    bmax = verts.max(axis=0)
    print(
        f"[view_hair_ply] bbox min {bmin} max {bmax} "
        f"size {(bmax - bmin)}"
    )
    return verts, edges


def main() -> None:
    repo = Path(__file__).resolve().parent.parent
    default = repo / "public" / "hair" / "brunohair.ply"
    ply_path = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else default

    if not ply_path.is_file():
        raise SystemExit(f"Not a file: {ply_path}")

    verts, edges = load_hairstep_ply(ply_path)

    line_set = o3d.geometry.LineSet()
    line_set.points = o3d.utility.Vector3dVector(verts)
    line_set.lines = o3d.utility.Vector2iVector(edges)
    # Per-segment color (brown hair); Open3D expects one RGB per line
    n_lines = len(edges)
    if n_lines > 0:
        color = np.tile(np.array([[0.15, 0.12, 0.1]]), (n_lines, 1))
        line_set.colors = o3d.utility.Vector3dVector(color)

    o3d.visualization.draw_geometries(
        [line_set],
        window_name=f"Hair PLY — {ply_path.name}",
        width=1280,
        height=720,
    )


if __name__ == "__main__":
    main()
