"""
Convert a 3DGS INRIA .ply to the .splat binary format that drei's <Splat> loads.

The .splat format bakes SH-DC → RGB at conversion time, sidestepping any
per-loader SH decoding differences (the root cause of GS-LRM green tints).

Usage:
    python3 scripts/convert.py [src.ply] [dst.splat]
    python3 scripts/convert.py                          # uses defaults below

Defaults:
    src = public/models/gaussians.ply
    dst = public/models/gaussians.splat

Tuning: if the result is still tinted, adjust GAIN_R/G/B (default 1.0).
"""

import sys, pathlib, re
import numpy as np

NP_TYPES = {
    'float': 'f4', 'float32': 'f4',
    'double': 'f8', 'float64': 'f8',
    'uchar': 'u1', 'uint8': 'u1',
    'char': 'i1', 'int8': 'i1',
    'ushort': 'u2', 'uint16': 'u2',
    'short': 'i2', 'int16': 'i2',
    'uint': 'u4', 'uint32': 'u4',
    'int': 'i4', 'int32': 'i4',
}

SH_C0 = 0.28209479177387814

# Per-channel gain — increase if colors look too dark, decrease if blown out.
GAIN_R, GAIN_G, GAIN_B = 1.0, 1.0, 1.0


def convert(src: pathlib.Path, dst: pathlib.Path):
    raw = src.read_bytes()
    hdr_end = raw.index(b'end_header\n') + len(b'end_header\n')
    header = raw[:hdr_end].decode('ascii')
    body = raw[hdr_end:]

    props = re.findall(r'^property (\S+) (\S+)$', header, flags=re.M)
    m = re.search(r'element vertex (\d+)', header)
    assert m, "No vertex count in PLY header"
    vcount = int(m.group(1))

    dtype = np.dtype([(n, NP_TYPES[t]) for t, n in props])
    v = np.frombuffer(body, dtype=dtype, count=vcount)

    # ── Decode colors from SH DC coefficients ──────────────────────────────
    r = np.clip(GAIN_R * (0.5 + SH_C0 * v['f_dc_0']), 0.0, 1.0)
    g = np.clip(GAIN_G * (0.5 + SH_C0 * v['f_dc_1']), 0.0, 1.0)
    b = np.clip(GAIN_B * (0.5 + SH_C0 * v['f_dc_2']), 0.0, 1.0)
    a = 1.0 / (1.0 + np.exp(-v['opacity'].astype(np.float32)))

    # ── Scale: exp-activate (stored as log-scale in INRIA format) ───────────
    sx = np.exp(v['scale_0'].astype(np.float32))
    sy = np.exp(v['scale_1'].astype(np.float32))
    sz = np.exp(v['scale_2'].astype(np.float32))

    # ── Rotation quaternion: normalize ──────────────────────────────────────
    rot = np.column_stack([
        v['rot_0'].astype(np.float32),
        v['rot_1'].astype(np.float32),
        v['rot_2'].astype(np.float32),
        v['rot_3'].astype(np.float32),
    ])
    rot /= np.linalg.norm(rot, axis=1, keepdims=True).clip(min=1e-8)

    # ── Sort by opacity descending (improves alpha blending quality) ─────────
    order = np.argsort(-a)
    r, g, b, a = r[order], g[order], b[order], a[order]
    sx, sy, sz = sx[order], sy[order], sz[order]
    rot = rot[order]
    x = v['x'].astype(np.float32)[order]
    y = v['y'].astype(np.float32)[order]
    z = v['z'].astype(np.float32)[order]

    # ── Pack into .splat binary (32 bytes / splat) ───────────────────────────
    # Layout: [x y z f32×3] [sx sy sz f32×3] [r g b a u8×4] [q0..q3 u8×4]
    out = np.zeros(vcount, dtype=np.dtype([
        ('x', 'f4'), ('y', 'f4'), ('z', 'f4'),
        ('sx', 'f4'), ('sy', 'f4'), ('sz', 'f4'),
        ('r', 'u1'), ('g', 'u1'), ('b', 'u1'), ('a', 'u1'),
        ('q0', 'u1'), ('q1', 'u1'), ('q2', 'u1'), ('q3', 'u1'),
    ]))
    out['x'], out['y'], out['z'] = x, y, z
    out['sx'], out['sy'], out['sz'] = sx, sy, sz
    out['r'] = (r * 255).astype(np.uint8)
    out['g'] = (g * 255).astype(np.uint8)
    out['b'] = (b * 255).astype(np.uint8)
    out['a'] = (a * 255).astype(np.uint8)
    out['q0'] = np.clip(rot[:, 0] * 128 + 128, 0, 255).astype(np.uint8)
    out['q1'] = np.clip(rot[:, 1] * 128 + 128, 0, 255).astype(np.uint8)
    out['q2'] = np.clip(rot[:, 2] * 128 + 128, 0, 255).astype(np.uint8)
    out['q3'] = np.clip(rot[:, 3] * 128 + 128, 0, 255).astype(np.uint8)

    dst.write_bytes(out.tobytes())
    print(f'Wrote {vcount} splats ({out.dtype.itemsize} B/splat) → {dst}')


if __name__ == '__main__':
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'public/models/gaussians.ply')
    dst = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else src.with_suffix('.splat'))
    convert(src, dst)
