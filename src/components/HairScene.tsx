// ============================================================
// HairScene — COCO's domain
//
// Three.js scene via react-three-fiber.
// Currently uses placeholder geometry (sphere = head, boxes = hair zones).
// Replace the geometry with loaded .glb meshes once assets are ready.
//
// Props:
//   params   — HairParams driving mesh scale
//   colorRGB — hex string for hair material
//   profile  — optional UserHeadProfile; when provided, hair zones are
//              positioned dynamically from headProportions + anchors.
//              Falls back to hardcoded positions when absent.
// ============================================================

'use client';

import * as THREE from 'three';

import { HairParams, UserHeadProfile } from '@/types';
import { OrbitControls, Splat, useGLTF } from '@react-three/drei';
import React, { Suspense, useEffect, useMemo, useState } from 'react';

import { Canvas } from '@react-three/fiber';
import FlameMesh from './FlameMesh';
import HairStrandMesh from './HairStrandMesh';
import { parseNPY } from '@/lib/parseNPY';

// ── Polycam head ─────────────────────────────────────────────
function PolycamHeadGLB() {
  const { scene } = useGLTF('/models/bruno_polycam.glb');

  const { scale, centerOffset, heightInScene } = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const box    = new THREE.Box3().setFromObject(scene);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (1.6 / Math.max(size.x, 0.001)) * 5 * 0.7 * 1.2;
    return { scale: s, centerOffset: center, heightInScene: size.y * s };
  }, [scene]);

  return (
    <group
      scale={scale}
      rotation={[3 * Math.PI / 180, 35 * Math.PI / 180, -6 * Math.PI / 180]}
      position={[
        -centerOffset.x * scale - heightInScene * 0.045,
        -centerOffset.y * scale - heightInScene * 0.3,
        -centerOffset.z * scale + heightInScene * 0.10,
      ]}
    >
      <primitive object={scene} castShadow receiveShadow />
    </group>
  );
}

function PolycamHead() {
  return (
    <Suspense fallback={null}>
      <PolycamHeadGLB />
    </Suspense>
  );
}

// ── Hair depth points (npy) ─────────────────────────────────

// Renders a .npy file as a visible point cloud.
// Handles two shapes:
//   (N, 3)  — direct XYZ points (used as-is, scaled by scale/position group)
//   (H, W)  — 2D depth map: constructs 3D points by mapping pixel (i,j) →
//              (x, y) in PLY bbox space and depth value → z offset.
//              Subsampled every DEPTH_STEP pixels to keep point count manageable.
const DEPTH_STEP = 6; // sample every Nth pixel from the depth map
// PLY bbox extents used to normalize depth map pixel coords into PLY space.
const PLY_W = 0.34; const PLY_H = 0.37; const PLY_D = 0.30;
const PLY_Y_CENTER = 1.72; const PLY_Z_CENTER = -0.016;

function HairDepthPoints({ url, color, scale, position }: {
  url: string;
  color: string;
  scale: number;
  position: [number, number, number];
}) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    parseNPY(url).then(({ data, shape }) => {
      if (cancelled) return;
      const g = new THREE.BufferGeometry();

      let positions: Float32Array;

      if (shape.length === 2) {
        // 2D depth map (H, W): build point cloud in PLY coordinate space
        const [H, W] = shape;
        const pts: number[] = [];
        for (let i = 0; i < H; i += DEPTH_STEP) {
          for (let j = 0; j < W; j += DEPTH_STEP) {
            const d = data[i * W + j];
            if (d <= 0) continue; // skip background/empty pixels
            const x = ((j - W / 2) / W) * PLY_W;
            const y = PLY_Y_CENTER - ((i - H / 2) / H) * PLY_H;
            const z = PLY_Z_CENTER + (d - 0.5) * PLY_D;
            pts.push(x, y, z);
          }
        }
        positions = new Float32Array(pts);
      } else {
        // (N, 3): direct XYZ points
        positions = new Float32Array(data);
      }

      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      setGeo(g);
    });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => () => { geo?.dispose(); }, [geo]);

  if (!geo) return null;
  return (
    <group scale={scale} position={position}>
      <points geometry={geo}>
        <pointsMaterial color={color} size={0.02} sizeAttenuation depthWrite={false} />
      </points>
    </group>
  );
}

// ── Scene content ───────────────────────────────────────────

// PLY hair bbox (scene units): width≈0.34, height≈0.37, depth≈0.30, center y≈1.72
// Head is 1.6 canonical × MODEL_SCALE 1.5 ≈ 2.4 units wide, crown at world y≈1.26.
// Scale 9 brings hair width to ~3.1 units (matching head), matching the observed
// 50%-too-narrow issue.  Y: PLY_ymin(1.5373)*9=13.84; pos_y = crown(1.26)−13.84=−12.58
// Z: PLY z-center is −0.016; at scale 9 that's −0.14, so +0.14 re-centers it.
const HAIR_PLY_SCALE   = 13.109;
const HAIR_PLY_POS: [number, number, number] = [0, -23.349, 0.714];

// Dev: all known hair layers. Toggle multiple simultaneously to identify pairs.
// Colors are fixed per layer so you can distinguish overlapping sets visually.
// type 'ply' → HairStrandMesh, type 'npy' → HairDepthPoints
const HAIR_LAYERS = [
  { type: 'ply', id: 'strands_1',    label: 'Strands 1',   url: '/hair/strands_1.ply',   color: '#3b1f0a', lineWidth: 0.8, renderOrder: 0 },
  { type: 'ply', id: 'depth_1',      label: 'Depth 1',     url: '/hair/depth_1.ply',     color: '#3b1f0a', lineWidth: 1.0, renderOrder: 1 },
  { type: 'ply', id: 'preset_a',     label: 'Preset A',    url: '/hair/preset_a.ply',    color: '#c8a050', lineWidth: 0.8, renderOrder: 0 },
  { type: 'ply', id: 'guest',        label: 'Guest',       url: '/hair/guest.ply',       color: '#c0b090', lineWidth: 0.8, renderOrder: 0 },
  { type: 'ply', id: 'brunohair',    label: 'Bruno',       url: '/hair/brunohair.ply',   color: '#0f0d0c', lineWidth: 0.8, renderOrder: 0 },
  { type: 'npy', id: 'bruno_depth',  label: 'Bruno Depth', url: '/hair/brunohair_depth.npy', color: '#44aaff', lineWidth: 0, renderOrder: 0 },
] as const;


interface FlameData {
  vertices: number[][];
  faces:    number[][];
}

interface SceneProps {
  showPolycam?: boolean;
  showSplat?: boolean;
  showFlame?: boolean;
  visibleLayers: Set<string>;
  flameData?: FlameData;
}

function Scene({ showPolycam = false, showSplat = true, showFlame = false, visibleLayers, flameData }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]}  intensity={1.0} castShadow />
      <directionalLight position={[0, 2, 5]}   intensity={0.8} />

      {showPolycam && <PolycamHead />}

      {showSplat && (
        <Suspense fallback={null}>
          <Splat src="/models/gaussians.splat" alphaTest={0.02} scale={2.772} position={[0, -0.07, 0.48]} rotation={[-Math.PI / 2, Math.PI, Math.PI]} />
        </Suspense>
      )}

      {HAIR_LAYERS.filter(l => visibleLayers.has(l.id)).map(l =>
        l.type === 'npy' ? (
          <HairDepthPoints
            key={l.id}
            url={l.url}
            color={l.color}
            scale={HAIR_PLY_SCALE}
            position={HAIR_PLY_POS}
          />
        ) : (
          <HairStrandMesh
            key={l.id}
            url={l.url}
            color={l.color}
            scale={HAIR_PLY_SCALE}
            position={HAIR_PLY_POS}
            lineWidth={l.lineWidth}
            renderOrder={l.renderOrder}
          />
        )
      )}

      {showFlame && flameData && (
        <FlameMesh vertices={flameData.vertices} faces={flameData.faces} />
      )}

      <OrbitControls
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 + (10 * Math.PI / 180)}
        minDistance={2.5}
        maxDistance={7.8}
      />
    </>
  );
}

// ── Public component ────────────────────────────────────────

interface HairSceneProps {
  params:     HairParams;
  colorRGB?:  string;
  profile?:   UserHeadProfile;
  flameData?: FlameData;
}

export default function HairScene({ params: _params, colorRGB: _colorRGB, profile: _profile, flameData }: HairSceneProps) {
  const [showPolycam, setShowPolycam] = useState(false);
  const [showSplat, setShowSplat]     = useState(true);
  const [showFlame, setShowFlame]     = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    new Set(['strands_1', 'depth_1'])
  );

  const toggleLayer = (id: string) =>
    setVisibleLayers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const btnStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 12,
    background: '#000', color: '#fff', border: 'none',
    borderRadius: 4, cursor: 'pointer',
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        shadows
        gl={{ toneMapping: THREE.NoToneMapping }}
        camera={{ position: [0, 0, 7.8], fov: 45 }}
        style={{ width: '100%', height: '100%', background: '#001f5b' }}
      >
        <Scene showPolycam={showPolycam} showSplat={showSplat} showFlame={showFlame} flameData={flameData} visibleLayers={visibleLayers} />
      </Canvas>
      <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '90%' }}>
        <button onClick={() => setShowPolycam(v => !v)} style={{ ...btnStyle, opacity: showPolycam ? 1 : 0.4 }}>
          polycam
        </button>
        <button onClick={() => setShowSplat(v => !v)} style={{ ...btnStyle, opacity: showSplat ? 1 : 0.4 }}>
          gaussians
        </button>
        <button onClick={() => setShowFlame(v => !v)} style={{ ...btnStyle, opacity: showFlame ? 1 : 0.4, outline: flameData ? '2px solid #44ffdd' : 'none' }}>
          flame
        </button>
        {HAIR_LAYERS.map(l => (
          <button key={l.id} onClick={() => toggleLayer(l.id)} style={{
            ...btnStyle,
            outline: visibleLayers.has(l.id) ? `2px solid ${l.color}` : 'none',
            opacity: visibleLayers.has(l.id) ? 1 : 0.4,
          }}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// TODO (Coco): replace placeholder geometry with .glb
//
// import { useGLTF } from '@react-three/drei';
//
// function HeadMesh() {
//   const { scene } = useGLTF('/models/head.glb');
//   return <primitive object={scene} />;
// }
//
// Use updateHairMesh(params) below to drive .glb mesh groups:
// ============================================================

export function updateHairMesh(
  scene: THREE.Object3D,
  params: HairParams
) {
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (child.name === 'Hair_Top') {
      child.scale.y = params.topLength;
    }
    if (child.name.startsWith('Hair_Side')) {
      child.scale.y = params.sideLength;
      child.scale.x = 1 - params.taper * 0.5;
    }
    if (child.name === 'Hair_Back') {
      child.scale.y = params.backLength;
    }

    if (child.name.startsWith('Hair_') && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.roughness = 0.5 + params.messiness * 0.5;
    }
  });
}
