import * as THREE from 'three';

export interface CanonicalBBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
}

export interface CanonicalizedMesh {
  rotation: THREE.Matrix3;
  center: THREE.Vector3;
  positions: Float32Array;
  bbox: CanonicalBBox;
  extents: THREE.Vector3;
}

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const UP_ALIGNMENT_FALLBACK = 0.6;

function vertexCount(verts: Float32Array | number[][]): number {
  return verts instanceof Float32Array ? verts.length / 3 : verts.length;
}

function readVertex(verts: Float32Array | number[][], index: number, out: THREE.Vector3): THREE.Vector3 {
  if (verts instanceof Float32Array) {
    return out.set(verts[index * 3], verts[index * 3 + 1], verts[index * 3 + 2]);
  }
  const v = verts[index];
  return out.set(v[0], v[1], v[2]);
}

function computeBBox(positions: Float32Array): CanonicalBBox {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
  };
}

function jacobiEigenSymmetric3(
  matrix: number[][],
): { eigenvalues: number[]; eigenvectors: THREE.Vector3[] } {
  const a = matrix.map(row => row.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < 16; iter++) {
    let p = 0;
    let q = 1;
    let max = Math.abs(a[0][1]);
    const candidates: Array<[number, number]> = [[0, 2], [1, 2]];
    for (const [i, j] of candidates) {
      const value = Math.abs(a[i][j]);
      if (value > max) {
        max = value;
        p = i;
        q = j;
      }
    }

    if (max < 1e-10) break;

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    for (let r = 0; r < 3; r++) {
      if (r === p || r === q) continue;
      const arp = a[r][p];
      const arq = a[r][q];
      a[r][p] = c * arp - s * arq;
      a[p][r] = a[r][p];
      a[r][q] = s * arp + c * arq;
      a[q][r] = a[r][q];
    }

    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let r = 0; r < 3; r++) {
      const vrp = v[r][p];
      const vrq = v[r][q];
      v[r][p] = c * vrp - s * vrq;
      v[r][q] = s * vrp + c * vrq;
    }
  }

  const eigenvalues = [a[0][0], a[1][1], a[2][2]];
  const eigenvectors = [
    new THREE.Vector3(v[0][0], v[1][0], v[2][0]).normalize(),
    new THREE.Vector3(v[0][1], v[1][1], v[2][1]).normalize(),
    new THREE.Vector3(v[0][2], v[1][2], v[2][2]).normalize(),
  ];

  return { eigenvalues, eigenvectors };
}

function pickAxisIndex(
  axes: THREE.Vector3[],
  preferred: THREE.Vector3,
  candidates: number[],
): number {
  let bestIndex = candidates[0];
  let bestAlignment = -Infinity;
  for (const index of candidates) {
    const alignment = Math.abs(axes[index].dot(preferred));
    if (alignment > bestAlignment) {
      bestAlignment = alignment;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function canonicalizeMeshOrientation(
  verts: Float32Array | number[][],
): CanonicalizedMesh {
  const count = vertexCount(verts);
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    center.add(readVertex(verts, i, point));
  }
  center.multiplyScalar(1 / Math.max(count, 1));

  let xx = 0, xy = 0, xz = 0;
  let yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < count; i++) {
    readVertex(verts, i, point).sub(center);
    xx += point.x * point.x;
    xy += point.x * point.y;
    xz += point.x * point.z;
    yy += point.y * point.y;
    yz += point.y * point.z;
    zz += point.z * point.z;
  }

  const { eigenvalues, eigenvectors } = jacobiEigenSymmetric3([
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz],
  ]);

  const sorted = eigenvectors
    .map((axis, index) => ({ axis, value: eigenvalues[index] }))
    .sort((a, b) => b.value - a.value);

  const candidateAxes = sorted.map(item => item.axis.clone().normalize());
  const bestUpIndex = pickAxisIndex(candidateAxes, WORLD_Y, [0, 1, 2]);
  const bestUpAlignment = Math.abs(candidateAxes[bestUpIndex].dot(WORLD_Y));
  const upIndex = bestUpAlignment >= UP_ALIGNMENT_FALLBACK ? bestUpIndex : 0;

  const remaining = [0, 1, 2].filter(index => index !== upIndex);
  const xIndex = pickAxisIndex(candidateAxes, WORLD_X, remaining);

  let yAxis = candidateAxes[upIndex].clone();
  if (yAxis.dot(WORLD_Y) < 0) yAxis.multiplyScalar(-1);

  let xAxis = candidateAxes[xIndex].clone();
  if (xAxis.dot(WORLD_X) < 0) xAxis.multiplyScalar(-1);

  let zAxis = xAxis.clone().cross(yAxis).normalize();
  xAxis = yAxis.clone().cross(zAxis).normalize();

  const rotation = new THREE.Matrix3().set(
    xAxis.x, xAxis.y, xAxis.z,
    yAxis.x, yAxis.y, yAxis.z,
    zAxis.x, zAxis.y, zAxis.z,
  );

  const positions = new Float32Array(count * 3);
  const rotated = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    readVertex(verts, i, point).sub(center);
    rotated.copy(point).applyMatrix3(rotation).add(center);
    positions[i * 3] = rotated.x;
    positions[i * 3 + 1] = rotated.y;
    positions[i * 3 + 2] = rotated.z;
  }

  const bbox = computeBBox(positions);
  const extents = new THREE.Vector3(
    bbox.maxX - bbox.minX,
    bbox.maxY - bbox.minY,
    bbox.maxZ - bbox.minZ,
  );

  return { rotation, center, positions, bbox, extents };
}
