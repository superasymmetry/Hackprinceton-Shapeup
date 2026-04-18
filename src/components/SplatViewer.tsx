'use client';

import { OrbitControls, Splat } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';

export default function SplatViewer() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 60 }}
      style={{ width: '100vw', height: '100vh', background: '#111' }}
    >
      <Suspense fallback={null}>
        <Splat src="/models/gaussians.ply" />
      </Suspense>
      <OrbitControls />
    </Canvas>
  );
}
