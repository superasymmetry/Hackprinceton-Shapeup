/**
 * Converts a 3D Gaussian Splatting binary PLY to an OBJ point-cloud.
 * Samples every `step`-th gaussian to keep the output size manageable.
 * Works server-side (Buffer, no browser APIs).
 */

const PLY_TYPE_SIZES: Record<string, number> = {
  float: 4, float32: 4, double: 8, float64: 8,
  char: 1, uchar: 1, short: 2, ushort: 2,
  int: 4, uint: 4, int8: 1, uint8: 1,
  int16: 2, uint16: 2, int32: 4, uint32: 4,
};

export function gaussianPlyBufferToObj(buffer: Buffer, step = 20): string {
  console.log('[gaussianPlyToObj] starting conversion — input bytes:', buffer.length, '| step:', step);

  // Locate end_header marker
  const marker = 'end_header\n';
  let dataStart = -1;
  for (let i = 0; i < buffer.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (buffer[i + j] !== marker.charCodeAt(j)) { match = false; break; }
    }
    if (match) { dataStart = i + marker.length; break; }
  }

  if (dataStart === -1) {
    console.error('[gaussianPlyToObj] end_header not found in PLY buffer');
    throw new Error('Invalid PLY: end_header not found');
  }

  const header = buffer.slice(0, dataStart).toString('utf8');
  console.log('[gaussianPlyToObj] PLY header (first 400 chars):\n', header.slice(0, 400));

  const vertexCountMatch = header.match(/element vertex (\d+)/);
  if (!vertexCountMatch) {
    console.error('[gaussianPlyToObj] element vertex count not found in header');
    throw new Error('Invalid PLY: element vertex not found');
  }
  const vertexCount = parseInt(vertexCountMatch[1]);
  console.log('[gaussianPlyToObj] total vertex count:', vertexCount, '| will sample every', step, '→ ~', Math.ceil(vertexCount / step), 'points');

  // Parse property list to determine per-vertex stride and x/y/z offsets
  const propLines = [...header.matchAll(/^property (\S+) (\S+)$/gm)];
  let stride = 0;
  let xOff = -1, yOff = -1, zOff = -1;
  for (const [, type, name] of propLines) {
    const size = PLY_TYPE_SIZES[type] ?? 4;
    if (name === 'x') xOff = stride;
    else if (name === 'y') yOff = stride;
    else if (name === 'z') zOff = stride;
    stride += size;
  }

  console.log('[gaussianPlyToObj] computed stride:', stride, 'bytes | xOff:', xOff, 'yOff:', yOff, 'zOff:', zOff);

  if (xOff < 0 || yOff < 0 || zOff < 0 || stride === 0) {
    console.error('[gaussianPlyToObj] could not locate x/y/z offsets in property list');
    throw new Error('Invalid PLY: x/y/z properties not found');
  }

  // Extract vertex positions (subsampled)
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset + dataStart,
    buffer.length - dataStart,
  );

  const lines: string[] = [
    '# OBJ point cloud converted from 3DGS gaussians.ply by gaussianPlyToObj.ts',
    `# original vertices: ${vertexCount}  sampled every: ${step}`,
    '',
  ];

  let sampledCount = 0;
  for (let i = 0; i < vertexCount; i += step) {
    const base = i * stride;
    const x = view.getFloat32(base + xOff, true);
    const y = view.getFloat32(base + yOff, true);
    const z = view.getFloat32(base + zOff, true);
    lines.push(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`);
    sampledCount++;
  }

  console.log('[gaussianPlyToObj] sampled', sampledCount, 'points');

  const obj = lines.join('\n');
  console.log('[gaussianPlyToObj] OBJ generated — lines:', lines.length, '| byte size:', Buffer.byteLength(obj, 'utf8'));
  return obj;
}
