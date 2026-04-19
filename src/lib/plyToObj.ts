/**
 * Converts a HairStep binary PLY (float64 vertices + int32 edge pairs) to OBJ format.
 * The OBJ uses `l` (line) elements to represent hair strand edges.
 * OBJ vertex indices are 1-based.
 */
export function plyBufferToObj(plyBuffer: Buffer): string {
  console.log('[plyToObj] starting PLY→OBJ conversion, input byte length:', plyBuffer.length);

  // Find end_header marker in the ASCII header
  const marker = 'end_header\n';
  let dataStart = -1;
  for (let i = 0; i < plyBuffer.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (plyBuffer[i + j] !== marker.charCodeAt(j)) { match = false; break; }
    }
    if (match) { dataStart = i + marker.length; break; }
  }

  if (dataStart === -1) {
    console.error('[plyToObj] could not find end_header marker in PLY buffer');
    throw new Error('Invalid PLY: end_header marker not found');
  }

  const header = plyBuffer.slice(0, dataStart).toString('utf8');
  console.log('[plyToObj] PLY header:\n', header);

  const vertexCountMatch = header.match(/element vertex (\d+)/);
  const edgeCountMatch   = header.match(/element edge (\d+)/);

  if (!vertexCountMatch) {
    console.error('[plyToObj] could not parse vertex count from PLY header');
    throw new Error('Invalid PLY: no element vertex found');
  }

  const vertexCount = parseInt(vertexCountMatch[1]);
  const edgeCount   = edgeCountMatch ? parseInt(edgeCountMatch[1]) : 0;
  console.log('[plyToObj] vertexCount:', vertexCount, '| edgeCount:', edgeCount);

  // Parse binary data — vertices: 3×float64 (24 bytes each), edges: 2×int32 (8 bytes each)
  const view = new DataView(
    plyBuffer.buffer,
    plyBuffer.byteOffset + dataStart,
    plyBuffer.length - dataStart,
  );
  let offset = 0;

  // Read vertices
  const lines: string[] = [];
  lines.push('# OBJ converted from HairStep PLY by plyToObj.ts');
  lines.push(`# vertices: ${vertexCount}  edges: ${edgeCount}`);
  lines.push('');

  for (let i = 0; i < vertexCount; i++) {
    const x = view.getFloat64(offset, true); offset += 8;
    const y = view.getFloat64(offset, true); offset += 8;
    const z = view.getFloat64(offset, true); offset += 8;
    lines.push(`v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
  }
  console.log('[plyToObj] read', vertexCount, 'vertices (offset after vertices:', offset, ')');

  lines.push('');

  // Read edges and write as OBJ line elements (1-based indices)
  for (let i = 0; i < edgeCount; i++) {
    const v1 = view.getInt32(offset, true); offset += 4;
    const v2 = view.getInt32(offset, true); offset += 4;
    lines.push(`l ${v1 + 1} ${v2 + 1}`);
  }
  console.log('[plyToObj] read', edgeCount, 'edges (offset after edges:', offset, ')');

  const obj = lines.join('\n');
  console.log('[plyToObj] OBJ generated — total lines:', lines.length, '| output byte size:', Buffer.byteLength(obj, 'utf8'));
  return obj;
}
