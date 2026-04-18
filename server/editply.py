import numpy as np
from plyfile import PlyData, PlyElement

ply = PlyData.read(r"C:\Users\stringbot\Documents\Github\HackPrinceton\public\hair\strands_1.ply")
verts = ply["vertex"]

# Extract positions (preserve float64 to match parsePLY expectations)
x, y, z = verts["x"].copy(), verts["y"].copy(), verts["z"].copy()

# 1. Scale hair longer (stretch in Y axis)
y = y * 1.3

# Reconstruct vertices as float64 (binary PLY, no vertex colors — renderer uses material color)
new_verts = np.array(
    list(zip(x, y, z)),
    dtype=[("x","f8"),("y","f8"),("z","f8")]
)
el = PlyElement.describe(new_verts, "vertex")

# Preserve edge element and write as binary (edges must stay for parsePLY to render strands)
PlyData([el, ply["edge"]], text=False).write(r"C:\Users\stringbot\Documents\Github\HackPrinceton\public\hair\hair_modified.ply")