import sys, pathlib, re
import numpy as np

NP_TYPES = {
    'float': 'f4', 'float32': 'f4',
    'double': 'f8', 'float64': 'f8',
    'uchar': 'u1', 'uint8':  'u1',
    'char':  'i1', 'int8':   'i1',
    'ushort':'u2', 'uint16': 'u2',
    'short': 'i2', 'int16':  'i2',
    'uint':  'u4', 'uint32': 'u4',
    'int':   'i4', 'int32':  'i4',
}
SKIP = {'red', 'green', 'blue'}

def clean_ply(src: pathlib.Path, dst: pathlib.Path):
    raw = src.read_bytes()
    hdr_end = raw.index(b'end_header\n') + len(b'end_header\n')
    header  = raw[:hdr_end].decode('ascii')
    body    = raw[hdr_end:]

    props = re.findall(r'^property (\S+) (\S+)$', header, flags=re.M)
    m = re.search(r'element vertex (\d+)', header)
    assert m, "No vertex count in PLY header"
    vcount = int(m.group(1))

    src_dtype = np.dtype([(n, NP_TYPES[t]) for t, n in props])
    arr = np.frombuffer(body, dtype=src_dtype, count=vcount)

    keep = [n for _, n in props if n not in SKIP]
    out  = np.ascontiguousarray(arr[keep])

    new_hdr = re.sub(
        r'^property (?:uchar|uint8) (?:red|green|blue)\n',
        '', header, flags=re.M,
    )
    dst.write_bytes(new_hdr.encode('ascii') + out.tobytes())
    print(f'Wrote {vcount} vertices ({out.dtype.itemsize} B/vertex) → {dst}')

if __name__ == '__main__':
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'public/models/gaussians.ply')
    dst = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else str(src))
    clean_ply(src, dst)
