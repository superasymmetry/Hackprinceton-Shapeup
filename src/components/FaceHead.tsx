'use client';

// ============================================================
// FaceHead — renders the user's face as a structural 3D mesh
//
// Pipeline:
//  1. Map x, y landmarks to scene space (ear-to-ear = 1.6 units).
//     outerScaleY cancels the non-uniform Y applied by the parent
//     group so the face isn't double-compressed.
//  2. Flat z projection: z = -p.z * zFeatureScale
//     (nose protrudes, eye sockets recess, forehead is roughly flat)
//     No hemisphere baseline — the head model has a flat face.
//  3. Index with canonical MediaPipe triangulation (898 triangles)
//  4. Solid skin-toned material with polygonOffset so it sits on
//     top of the head model without z-fighting.
// ============================================================

import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { FacemeshDatas } from '@react-three/drei';
import { FaceScanData } from '@/types';

// ── Coordinate conversion ──────────────────────────────────────
function landmarksToScene(
  landmarks: FaceScanData['landmarks'],
  imageWidth: number,
  imageHeight: number,
  outerScaleY: number,
  chinTargetY?: number,
): Float32Array {
  const lm = landmarks;

  const earToEarNorm = Math.abs(lm[454].x - lm[234].x);
  const scale   = 1.6 / Math.max(earToEarNorm, 0.01);
  const centerX = (lm[234].x + lm[454].x) / 2;
  const centerY = (lm[234].y + lm[454].y) / 2;

  // yScale: aspect-ratio correction (normalized y ≠ normalized x in non-square
  // video) divided by outerScaleY to cancel the parent group's non-uniform Y
  // scale, so the face isn't compressed a second time.
  const yScale = scale * (imageHeight / imageWidth) / outerScaleY;

  // MediaPipe z is in the same normalized unit as x/y (scaled by image width).
  // Multiply by scale to convert to scene units, then by 0.45 to keep the
  // nose protrusion physically plausible (~8–12% of face width).
  const zFeatureScale = scale * 0.63;

  // ── Mesh sizing & placement ────────────────────────────────────────────────
  // Find the top/bottom Y extents of the original (unscaled) face in scene units.
  // minY_mp = smallest MediaPipe y = topmost point on screen (landmark ~10).
  let minY_mp = Infinity, maxY_mp = -Infinity;
  lm.forEach(p => {
    if (p.y < minY_mp) minY_mp = p.y;
    if (p.y > maxY_mp) maxY_mp = p.y;
  });
  // Original top-edge Y in scene space (positive = up in Three.js).
  const originalTopY  = -(minY_mp - centerY) * yScale;
  // Original face height (used to compute the z sink).
  const faceHeight    = (maxY_mp - minY_mp) * yScale;

  // Scale the mesh to 67.32% of its natural size (0.792 × 0.85).
  const MESH_SCALE = 0.720;
  // After scaling, the bottom edge rises to originalBottomY * MESH_SCALE.
  // Add the difference back so the bottom stays where it was.
  const originalBottomY = originalTopY - faceHeight;
  const yShift = originalBottomY * (1 - MESH_SCALE);
  // Sink the mesh back toward the head surface by 1/22 of the face height.
  const zShift = -faceHeight / 24;

  // ── Chin alignment ────────────────────────────────────────────────────────
  // If the caller supplies chinTargetY (GLB chin in outer-group local space),
  // compute the vertical delta that moves lm[152] onto the GLB chin.
  // chinTargetY is in outer-group space; divide by outerScaleY to convert to
  // FaceHead-local space (the outer group multiplies local Y by outerScaleY).
  const y_chin_local = -(lm[152].y - centerY) * yScale * MESH_SCALE + yShift;
  const chinDelta = chinTargetY !== undefined
    ? chinTargetY / outerScaleY - y_chin_local
    : 0;

  const positions = new Float32Array(lm.length * 3);
  lm.forEach((p, i) => {
    const x = (p.x - centerX) * scale * MESH_SCALE;
    const y = -(p.y - centerY) * yScale * MESH_SCALE + yShift + chinDelta;
    // Flat projection: just feature depth — nose tip forward, eye sockets back.
    const z = -p.z * zFeatureScale + zShift;

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  });
  return positions;
}

// ── Build geometry ─────────────────────────────────────────────
function buildFaceGeometry(faceScanData: FaceScanData, outerScaleY: number, chinTargetY?: number): THREE.BufferGeometry {
  const { landmarks, imageWidth, imageHeight } = faceScanData;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(landmarksToScene(landmarks, imageWidth, imageHeight, outerScaleY, chinTargetY), 3),
  );
  geo.setIndex(FacemeshDatas.TRIANGULATION as number[]);
  geo.computeVertexNormals();
  return geo;
}

// ── Real-time vertex update ────────────────────────────────────
//
// Call this from a useFrame loop when live landmark data arrives.
// Mutates the existing BufferGeometry in-place (zero allocation) instead of
// rebuilding geometry each frame.
//
// Anchor landmarks — bone-proximate, expression-stable.  Use these 9 points
// to compute a rigid transform (centroid + SVD) that maps the reference scan
// frame to the current frame before applying per-landmark deformation, which
// eliminates global drift / mask sliding:
//
//   10  — forehead center (hairline midpoint)
//   127 — left temple (temporal bone)
//   356 — right temple (temporal bone)
//   116 — left cheekbone (zygomatic arch)
//   345 — right cheekbone (zygomatic arch)
//     6 — nose bridge (nasal bone — most stable)
//   234 — left ear root (jaw anchor)
//   454 — right ear root (jaw anchor)
//   152 — chin (mental protuberance)
//
export function updateFaceMeshPositions(
  geo: THREE.BufferGeometry,
  landmarks: Array<{ x: number; y: number; z: number }>,
  imageWidth: number,
  imageHeight: number,
  outerScaleY: number,
  chinTargetY?: number,
): void {
  const attr = geo.attributes.position as THREE.BufferAttribute;
  const positions = landmarksToScene(landmarks, imageWidth, imageHeight, outerScaleY, chinTargetY);
  (attr.array as Float32Array).set(positions);
  attr.needsUpdate = true;
  geo.computeVertexNormals();
}

// ── Component ──────────────────────────────────────────────────
interface FaceHeadProps {
  faceScanData: FaceScanData;
  /** The Y scale applied by the parent group (headHeight / 2.2).
   *  Passed so landmarksToScene can cancel it and avoid double-compression. */
  outerScaleY: number;
  /** GLB chin Y in outer-group local space. When provided, the whole face mesh
   *  is shifted vertically so lm[152] (chin) aligns with the canonical head chin. */
  chinTargetY?: number;
}

export default function FaceHead({ faceScanData, outerScaleY, chinTargetY }: FaceHeadProps) {
  const meshRef = useRef<THREE.Mesh>(null!);

  const geometry = useMemo(
    () => buildFaceGeometry(faceScanData, outerScaleY, chinTargetY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faceScanData, outerScaleY, chinTargetY],
  );

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({
      color:     '#e8be9a',
      roughness: 0.82,
      metalness: 0.0,
    }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} castShadow receiveShadow />
  );
}
