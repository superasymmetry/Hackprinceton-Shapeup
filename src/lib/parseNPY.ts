/**
 * Minimal .npy parser for float32 and float64 arrays (NumPy format v1.0).
 * Supports C-contiguous '<f4' and '<f8' (little-endian) files.
 * Always returns a Float32Array regardless of source dtype.
 */
export async function parseNPY(url: string): Promise<{ data: Float32Array; shape: number[] }> {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const view = new DataView(buffer);

  // Magic: \x93NUMPY (6 bytes) + version (2 bytes) + header_len uint16 LE (2 bytes)
  const headerLen = view.getUint16(8, /* littleEndian */ true);
  const headerBytes = new Uint8Array(buffer, 10, headerLen);
  const headerStr = new TextDecoder().decode(headerBytes);

  // Parse dtype, e.g. 'descr': '<f4' or '<f8'
  const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/);
  const descr = descrMatch ? descrMatch[1] : '<f4';
  const bytesPerElement = descr.includes('f8') ? 8 : 4;

  // Parse shape tuple from header, e.g. 'shape': (512, 512)
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
  const shape = shapeMatch
    ? shapeMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    : [];

  const dataOffset = 10 + headerLen;
  const totalElements = shape.reduce((a, b) => a * b, 1);
  const slice = buffer.slice(dataOffset, dataOffset + totalElements * bytesPerElement);

  let data: Float32Array;
  if (bytesPerElement === 8) {
    // Convert float64 → float32
    const f64 = new Float64Array(slice);
    data = new Float32Array(f64.length);
    for (let i = 0; i < f64.length; i++) data[i] = f64[i];
  } else {
    data = new Float32Array(slice);
  }

  return { data, shape };
}
