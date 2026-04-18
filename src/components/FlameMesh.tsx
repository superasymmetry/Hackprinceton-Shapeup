'use client';

import * as THREE from 'three';

import { useEffect, useMemo } from 'react';

// FLAME canonical space uses ~0.16 m ear-to-ear.
// Three.js scene canonical = 1.6 units ear-to-ear → scale factor 10.
const FLAME_TO_SCENE = 10;

interface FlameMeshProps {
  vertices: number[][];  // 5023×3, FLAME canonical space
  faces:    number[][];  // triangles
  opacity?: number;
  color?:   string;
}

export default function FlameMesh({
  vertices,
  faces,
  opacity = 0.18,
  color   = '#44ffdd',
}: FlameMeshProps) {
  const { solidGeo, edgesGeo } = useMemo(() => {
    // Build solid geometry for edge computation
    const positions = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length; i++) {
      positions[i * 3]     = vertices[i][0];
      positions[i * 3 + 1] = vertices[i][1];
      positions[i * 3 + 2] = vertices[i][2];
    }

    const indices = new Uint32Array(faces.length * 3);
    for (let i = 0; i < faces.length; i++) {
      indices[i * 3]     = faces[i][0];
      indices[i * 3 + 1] = faces[i][1];
      indices[i * 3 + 2] = faces[i][2];
    }

    const solid = new THREE.BufferGeometry();
    solid.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    solid.setIndex(new THREE.BufferAttribute(indices, 1));
    solid.computeVertexNormals();

    const edges = new THREE.EdgesGeometry(solid, 15); // 15° crease threshold
    return { solidGeo: solid, edgesGeo: edges };
  }, [vertices, faces]);

  // Dispose on unmount
  useEffect(() => () => {
    solidGeo.dispose();
    edgesGeo.dispose();
  }, [solidGeo, edgesGeo]);

  return (
    <group scale={FLAME_TO_SCENE}>
      {/* Faint solid fill so the mesh reads as a volume */}
      <mesh geometry={solidGeo} renderOrder={1}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity * 0.3}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* Edge wireframe — the "slightly visible" face topology */}
      <lineSegments geometry={edgesGeo} renderOrder={2}>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
          linewidth={1}
        />
      </lineSegments>
    </group>
  );
}
