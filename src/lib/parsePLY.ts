import * as THREE from 'three';

/**
 * Parses a HairStep binary PLY file (edge-based, float64 vertices).
 * Standard THREE.PLYLoader won't work — it expects face elements and float32.
 */
export interface PLYResult {
  geometry: THREE.BufferGeometry;
  bbox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export async function parsePLY(url: string): Promise<THREE.BufferGeometry> {
  const buf = await fetch(url).then(r => r.arrayBuffer());
  const headerBytes = new Uint8Array(buf);

  // Find end of ASCII header
  const marker = 'end_header\n';
  let dataStart = 0;
  for (let i = 0; i < headerBytes.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (headerBytes[i + j] !== marker.charCodeAt(j)) { match = false; break; }
    }
    if (match) { dataStart = i + marker.length; break; }
  }

  const header = new TextDecoder().decode(buf.slice(0, dataStart));
  const vertexCount = parseInt(header.match(/element vertex (\d+)/)![1]);
  const edgeCount   = parseInt(header.match(/element edge (\d+)/)?.[1] ?? '0');

  const view = new DataView(buf, dataStart);
  let offset = 0;

  // Vertices: 3 × float64 (24 bytes each)
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3]     = view.getFloat64(offset, true); offset += 8;
    positions[i * 3 + 1] = view.getFloat64(offset, true); offset += 8;
    positions[i * 3 + 2] = view.getFloat64(offset, true); offset += 8;
  }

  // Edges: 2 × int32 (8 bytes each)
  const indices = new Uint32Array(edgeCount * 2);
  for (let i = 0; i < edgeCount; i++) {
    indices[i * 2]     = view.getInt32(offset, true); offset += 4;
    indices[i * 2 + 1] = view.getInt32(offset, true); offset += 4;
  }

  // Log bounding box — needed to calibrate scale against head.glb (1.6 units ear-to-ear)
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  console.log(`[parsePLY] ${vertexCount} verts, ${edgeCount} edges`);
  console.log(`[parsePLY] bbox x:[${minX.toFixed(4)}, ${maxX.toFixed(4)}] y:[${minY.toFixed(4)}, ${maxY.toFixed(4)}] z:[${minZ.toFixed(4)}, ${maxZ.toFixed(4)}]`);
  console.log(`[parsePLY] width=${(maxX - minX).toFixed(4)} height=${(maxY - minY).toFixed(4)} depth=${(maxZ - minZ).toFixed(4)}`);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

export async function parsePLYWithBBox(url: string): Promise<PLYResult> {
  const buf = await fetch(url).then(r => r.arrayBuffer());
  const headerBytes = new Uint8Array(buf);

  const marker = 'end_header\n';
  let dataStart = 0;
  for (let i = 0; i < headerBytes.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (headerBytes[i + j] !== marker.charCodeAt(j)) { match = false; break; }
    }
    if (match) { dataStart = i + marker.length; break; }
  }

  const header = new TextDecoder().decode(buf.slice(0, dataStart));
  const vertexCount = parseInt(header.match(/element vertex (\d+)/)![1]);
  const edgeCount   = parseInt(header.match(/element edge (\d+)/)?.[1] ?? '0');

  const view = new DataView(buf, dataStart);
  let offset = 0;

  const positions = new Float32Array(vertexCount * 3);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = view.getFloat64(offset, true); offset += 8;
    const y = view.getFloat64(offset, true); offset += 8;
    const z = view.getFloat64(offset, true); offset += 8;
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const indices = new Uint32Array(edgeCount * 2);
  for (let i = 0; i < edgeCount; i++) {
    indices[i * 2]     = view.getInt32(offset, true); offset += 4;
    indices[i * 2 + 1] = view.getInt32(offset, true); offset += 4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return { geometry, bbox: { minX, maxX, minY, maxY, minZ, maxZ } };
}
