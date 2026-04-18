'use client';

// Renders the TrueDepth ARFaceGeometry mesh captured from the iOS app.
// Vertices are in ARKit camera space (metres, Y-up, Z toward viewer).
// We normalize and center them to match the scene's canonical head scale.

import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { ARFaceMesh } from '@/types';

interface ARFaceHeadProps {
  arMesh: ARFaceMesh;
}

function buildARGeometry(arMesh: ARFaceMesh): { geo: THREE.BufferGeometry; faceHeight: number } {
  const { vertices, indices } = arMesh;

  // Find bounding box to normalize into scene units
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const [x, y, z] of vertices) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const faceWidth = maxX - minX;
  // Scale so face width = 1.6 scene units (matches MediaPipe canonical scale)
  const scale = 1.6 / Math.max(faceWidth, 0.001);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const positions = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++) {
    const [x, y, z] = vertices[i];
    positions[i * 3]     =  (x - cx) * scale;
    positions[i * 3 + 1] =  (y - cy) * scale;
    // ARKit Z: negative = away from camera. Flip so nose points toward viewer.
    positions[i * 3 + 2] = -(z - minZ) * scale;
  }

  const indexArray = new Uint16Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    indexArray[i * 3]     = indices[i][0];
    indexArray[i * 3 + 1] = indices[i][1];
    indexArray[i * 3 + 2] = indices[i][2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indexArray, 1));
  geo.computeVertexNormals();
  return { geo, faceHeight: (maxY - minY) * scale };
}

const MESH_SCALE = 1.768; // 1.36 × 1.3

export default function ARFaceHead({ arMesh }: ARFaceHeadProps) {
  const { geo: geometry, faceHeight } = useMemo(() => buildARGeometry(arMesh), [arMesh]);

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({
      color:     '#e8be9a',
      roughness: 0.82,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Shift back by half the rendered face height, then forward 10% of face height.
  const zOffset = -(faceHeight * MESH_SCALE) / 2 + faceHeight * 0.1;

  return <mesh geometry={geometry} material={material} rotation={[0, Math.PI, 0]} scale={MESH_SCALE} position={[0, -faceHeight * 0.05, zOffset]} castShadow receiveShadow />;
}
