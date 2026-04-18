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
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { Canvas } from '@react-three/fiber';
import FlameMesh from './FlameMesh';
import HairStrandMesh, { PLYBBox } from './HairStrandMesh';
import { SmirkTransform } from '@/hooks/useSmirk';
import { parseNPY } from '@/lib/parseNPY';
import { parseGaussianXYZ } from '@/lib/parsePLY';

const FLAME_TO_SCENE = 10;

// Convert SMIRK Procrustes rotation (image coords) to a Three.js Euler (scene coords).
//
// SMIRK R maps: FLAME canonical (y-up, z-toward-camera) → image-space landmarks
// (x=right, y=down, z=depth-into-screen).
//
// For a frontal face R_smirk ≈ diag(1,-1,-1) (y-flip dominant).
// Scene euler = rotation extracted from R_smirk @ diag(1,-1,-1), which gives
// identity for a frontal face and the correct head-pose deviation otherwise.
function smirkToEuler(R: number[][]): [number, number, number] {
  const M = [1, -1, -1]; // post-multiply to cancel canonical→image flip
  const mat = new THREE.Matrix4().set(
    R[0][0]*M[0], R[0][1]*M[1], R[0][2]*M[2], 0,
    R[1][0]*M[0], R[1][1]*M[1], R[1][2]*M[2], 0,
    R[2][0]*M[0], R[2][1]*M[1], R[2][2]*M[2], 0,
    0, 0, 0, 1,
  );
  const e = new THREE.Euler().setFromRotationMatrix(mat, 'XYZ');
  return [e.x, e.y, e.z];
}

// Derives hair scale and full 3D position so the hair sits correctly on the FLAME canonical head.
// The PLY coordinate system (HairStep output) has the head center at approximately y=1.72.
// FLAME canonical verts are in meters; FLAME_TO_SCENE converts them to scene units.
function computeHairTransform(
  flameVerts: number[][],
  plyBBox: PLYBBox,
): { scale: number; pos: [number, number, number] } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of flameVerts) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const flameHeadWidth = (maxX - minX) * FLAME_TO_SCENE;
  const flameCrownY    = maxY * FLAME_TO_SCENE;
  const faceHeight     = (maxY - minY) * FLAME_TO_SCENE;
  const flameCenterX   = ((minX + maxX) / 2) * FLAME_TO_SCENE;
  const flameCenterZ   = ((minZ + maxZ) / 2) * FLAME_TO_SCENE;

  const plyWidth   = plyBBox.maxX - plyBBox.minX;
  const plyYCenter = (plyBBox.minY + plyBBox.maxY) / 2;

  // Hair typically spans ~2.8× the face width (accounts for volume beyond the head).
  const SPREAD_RATIO = 2.79;
  const scale = (flameHeadWidth * SPREAD_RATIO) / Math.max(plyWidth, 1e-6);

  // Align the PLY Y-center to just below the crown (hair runs from crown down to ears/neck).
  const targetYCenter = flameCrownY - faceHeight * 0.95;
  const posY = targetYCenter - plyYCenter * scale;

  return { scale, pos: [flameCenterX, posY, flameCenterZ] };
}

// Derives Splat scale and full 3D position from FLAME crown and head width.
// SPLAT_CROWN_Z is the internal-Z of the crown, back-derived from:
//   canonical splatScale=2.772, splatPosY=-0.07, flameCrownY≈1.0
const SPLAT_CANONICAL_SCALE = 2.772;
const SPLAT_CANONICAL_HEAD_WIDTH = 1.6;
const SPLAT_CROWN_Z = (1.0 - (-0.07)) / 2.772;  // ≈ 0.386

function computeSplatTransform(
  flameVerts: number[][],
): { scale: number; pos: [number, number, number] } {
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of flameVerts) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const flameHeadWidth = (maxX - minX) * FLAME_TO_SCENE;
  const flameCrownY    = maxY * FLAME_TO_SCENE;
  const flameCenterX   = ((minX + maxX) / 2) * FLAME_TO_SCENE;
  const flameCenterZ   = ((minZ + maxZ) / 2) * FLAME_TO_SCENE;

  const scale = (flameHeadWidth / SPLAT_CANONICAL_HEAD_WIDTH) * SPLAT_CANONICAL_SCALE;
  const posY  = flameCrownY - SPLAT_CROWN_Z * scale;

  return { scale, pos: [flameCenterX, posY, flameCenterZ] };
}

// ── Gaussian head bounds ─────────────────────────────────────
//
// The splat renderer applies: scene = splatScale * R * g + splatPos
// where R is the rotation matrix for the parent group's smirkEuler.
// Crown and head width are measured in scene space after the transform.

interface GaussianHeadBounds {
  crownY: number;
  headWidth: number;
}

function computeHeadBoundsFromGaussians(
  centers: { x: number; y: number; z: number }[],
  splatScale: number,
  splatPosY: number,
): GaussianHeadBounds {
  let minGz = Infinity, minGx = Infinity, maxGx = -Infinity;
  for (const g of centers) {
    if (g.z < minGz) minGz = g.z;
    if (g.x < minGx) minGx = g.x;
    if (g.x > maxGx) maxGx = g.x;
  }
  return {
    crownY:    splatPosY - splatScale * minGz,
    headWidth: splatScale * (maxGx - minGx),
  };
}

// Crown-to-crown hair alignment.
function computeHairTransformCrownAligned(
  headBounds: GaussianHeadBounds,
  plyBBox: PLYBBox,
  flameCenterX: number,
  flameCenterZ: number,
): { scale: number; pos: [number, number, number] } {
  const plyWidth = plyBBox.maxX - plyBBox.minX;
  const SPREAD_RATIO = 2.79;
  const scale = (headBounds.headWidth * SPREAD_RATIO) / Math.max(plyWidth, 1e-6);
  const posY = headBounds.crownY - plyBBox.maxY * scale;
  return { scale, pos: [flameCenterX, posY, flameCenterZ] };
}

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

// Fallback hair transform used before FLAME data + PLY bbox are both available.
const HAIR_PLY_SCALE_DEFAULT   = 13.109;
const HAIR_PLY_POS_DEFAULT: [number, number, number] = [0, -23.349, 0.714];

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
  hairScale: number;
  hairPos: [number, number, number];
  splatScale: number;
  splatPos: [number, number, number];
  splatSrc: string;
  // SMIRK-derived Euler rotation applied to both gaussians splat and hair strands.
  // Replaces all hardcoded per-asset rotations — derived purely from the SMIRK
  // Procrustes transform so the objects align to the face mask orientation.
  smirkEuler: [number, number, number];
  onHairBBoxReady: (bbox: PLYBBox) => void;
}

function Scene({ showPolycam = false, showSplat = true, showFlame = false, visibleLayers, flameData, hairScale, hairPos, splatScale, splatPos, splatSrc, smirkEuler, onHairBBoxReady }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]}  intensity={1.0} castShadow />
      <directionalLight position={[0, 2, 5]}   intensity={0.8} />

      {showPolycam && <PolycamHead />}

      {/* SMIRK-aligned group: rotation derived from Procrustes transform.
          Both the gaussians splat and hair strands share the same head-pose
          rotation — no hardcoded per-asset rotation values. */}
      <group rotation={smirkEuler}>
        {showSplat && (
          <Suspense fallback={null}>
            <Splat src={splatSrc} alphaTest={0.02} scale={splatScale} position={splatPos} />
          </Suspense>
        )}

        {HAIR_LAYERS.filter(l => visibleLayers.has(l.id)).map(l =>
          l.type === 'npy' ? (
            <HairDepthPoints
              key={l.id}
              url={l.url}
              color={l.color}
              scale={hairScale}
              position={hairPos}
            />
          ) : (
            <HairStrandMesh
              key={l.id}
              url={l.url}
              color={l.color}
              scale={hairScale}
              position={hairPos}
              lineWidth={l.lineWidth}
              renderOrder={l.renderOrder}
              onBBoxReady={onHairBBoxReady}
            />
          )
        )}
      </group>

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
  params:          HairParams;
  colorRGB?:       string;
  profile?:        UserHeadProfile;
  flameData?:      FlameData;
  smirkTransform?: SmirkTransform;
}

export default function HairScene({ params: _params, colorRGB: _colorRGB, profile: _profile, flameData, smirkTransform }: HairSceneProps) {
  const [showPolycam, setShowPolycam] = useState(false);
  const [showSplat, setShowSplat]     = useState(true);
  const [showFlame, setShowFlame]     = useState(false);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    new Set(['strands_1', 'depth_1'])
  );
  const [plyBBox, setPlyBBox] = useState<PLYBBox | null>(null);

  // Local FLAME data fetched from a test image
  const [localFlameData, setLocalFlameData] = useState<FlameData | null>(null);
  // SMIRK Procrustes transform from the loadEthanBald test flow
  const [localSmirkTransform, setLocalSmirkTransform] = useState<SmirkTransform | null>(null);

  // FaceLift job state for ethansample_bald test
  const [ethanJobId, setEthanJobId]       = useState<string | null>(null);
  const [ethanJobStatus, setEthanJobStatus] = useState<'idle' | 'submitting' | 'processing' | 'done' | 'smirk-only' | 'error'>('idle');
  const [ethanSplatSrc, setEthanSplatSrc] = useState<string | null>(null);
  // Gaussian-derived head bounds used for crown-to-crown hair alignment.
  const [gaussianHeadBounds, setGaussianHeadBounds] = useState<GaussianHeadBounds | null>(null);

  // Loads ethansample_bald.png (falls back to ethansample.png), fires FaceLift +
  // SMIRK in parallel.  FaceLift result becomes the active splat source; SMIRK
  // result drives FLAME alignment for both the splat and Bruno hair.
  const loadEthanBald = useCallback(async () => {
    if (ethanJobStatus === 'submitting' || ethanJobStatus === 'processing') return;
    setGaussianHeadBounds(null);
    setEthanJobStatus('submitting');

    let dataUrl: string;
    try {
      const r = await fetch('/baldified/ethansample_bald.png');
      const blob = await (r.ok ? r : await fetch('/hair/ethansample.png')).blob();
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      setEthanJobStatus('error');
      return;
    }

    // SMIRK runs immediately (fast); FaceLift is long (~3 min)
    const smirkP = fetch('/api/smirk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: dataUrl }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { console.error('[SMIRK] error:', data.error); return; }
        console.log('[SMIRK] vertices:', data.vertices_canonical?.length, 'faces:', data.faces?.length);
        console.log('[SMIRK] transform R:', JSON.stringify(data.transform?.rotation));
        setLocalFlameData({ vertices: data.vertices_canonical, faces: data.faces });
        setLocalSmirkTransform(data.transform ?? null);
      })
      .catch(e => console.error('[SMIRK] fetch failed:', e));

    const faceliftP = fetch('/api/facelift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: dataUrl }),
    })
      .then(r => r.json())
      .then(data => {
        console.log('[FaceLift] submit response:', data);
        if (data.jobId) {
          setEthanJobId(data.jobId);
          setEthanJobStatus('processing');
        } else {
          console.warn('[FaceLift] no jobId, falling back to SMIRK-only mode');
          setLocalFlameData(prev => {
            setEthanJobStatus(prev ? 'smirk-only' : 'error');
            return prev;
          });
        }
      })
      .catch(e => { console.error('[FaceLift] fetch failed:', e); setEthanJobStatus('error'); });

    await Promise.all([smirkP, faceliftP]);
  }, [ethanJobStatus]);

  // Poll FaceLift until the job finishes, then set the splat source URL.
  useEffect(() => {
    if (ethanJobStatus !== 'processing' || !ethanJobId) return;
    const timer = setInterval(async () => {
      try {
        const res  = await fetch(`/api/facelift?jobId=${ethanJobId}`);
        if (!res.ok) {
          console.warn(`[FaceLift] poll HTTP ${res.status} — keeping polling`);
          return;
        }
        const data = await res.json() as { status: string; error?: string };
        console.log('[FaceLift] poll:', data.status, data.error ?? '');
        if (data.status === 'success') {
          clearInterval(timer);
          setEthanSplatSrc(`/api/facelift/${ethanJobId}/gaussians.ply`);
          setEthanJobStatus('done');
        } else if (data.status === 'error') {
          clearInterval(timer);
          console.error('[FaceLift] job failed:', data.error);
          setEthanJobStatus('error');
        }
      } catch (e) { console.warn('[FaceLift] poll transient error:', e); }
    }, 10_000);
    return () => clearInterval(timer);
  }, [ethanJobStatus, ethanJobId]);

  // Prop flameData (from real webcam scan) takes priority over test data
  const effectiveFlameData = flameData ?? localFlameData ?? undefined;
  // Prop smirkTransform (from real webcam scan) takes priority over test data
  const effectiveSmirkTransform = smirkTransform ?? localSmirkTransform ?? null;

  // ethanSplatSrc (FaceLift result) replaces the static gaussians.splat when ready
  const effectiveSplatSrc = ethanSplatSrc ?? '/models/gaussians.splat';

  // SMIRK-derived Euler rotation: cancels canonical→image flip so a frontal face
  // gives identity rotation, and non-frontal faces give the correct head pose.
  const smirkEuler = useMemo((): [number, number, number] => {
    if (!effectiveSmirkTransform) return [0, 0, 0];
    const euler = smirkToEuler(effectiveSmirkTransform.rotation);
    console.log('[SMIRK] scene euler (rad):', euler.map(v => v.toFixed(3)));
    return euler;
  }, [effectiveSmirkTransform]);

  // Splat + hair transforms: scale + full [x,y,z] position from FLAME, no hardcoded values.
  const splatTransform = useMemo(() => {
    if (!effectiveFlameData) return null;
    return computeSplatTransform(effectiveFlameData.vertices);
  }, [effectiveFlameData]);

  // Once the FaceLift splat and SMIRK-derived splatTransform are both ready,
  // parse the gaussian centers to compute the actual head crown and width.
  useEffect(() => {
    if (!ethanSplatSrc || !splatTransform) return;
    let cancelled = false;
    parseGaussianXYZ(ethanSplatSrc, 20)
      .then(centers => {
        if (cancelled || centers.length === 0) return;
        const bounds = computeHeadBoundsFromGaussians(
          centers,
          splatTransform.scale,
          splatTransform.pos[1],
        );
        console.log('[HairScene] gaussian crown', bounds.crownY.toFixed(3), 'headWidth', bounds.headWidth.toFixed(3));
        setGaussianHeadBounds(bounds);
      })
      .catch(e => console.warn('[HairScene] gaussian parse failed', e));
    return () => { cancelled = true; };
  }, [ethanSplatSrc, splatTransform]);

  // FLAME center X and Z for crown-aligned hair path.
  const flameCenterXZ = useMemo((): [number, number] => {
    if (!effectiveFlameData) return [0, 0];
    const verts = effectiveFlameData.vertices;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
    return [((minX + maxX) / 2) * FLAME_TO_SCENE, ((minZ + maxZ) / 2) * FLAME_TO_SCENE];
  }, [effectiveFlameData]);

  const hairTransform = useMemo(() => {
    if (!plyBBox) return null;
    if (gaussianHeadBounds) {
      return computeHairTransformCrownAligned(gaussianHeadBounds, plyBBox, flameCenterXZ[0], flameCenterXZ[1]);
    }
    if (effectiveFlameData) return computeHairTransform(effectiveFlameData.vertices, plyBBox);
    return null;
  }, [gaussianHeadBounds, effectiveFlameData, plyBBox, flameCenterXZ]);

  const hairScale = hairTransform?.scale ?? HAIR_PLY_SCALE_DEFAULT;
  const hairPos: [number, number, number] = hairTransform?.pos ?? HAIR_PLY_POS_DEFAULT;

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

  const ethanBaldLabel =
    ethanJobStatus === 'submitting'  ? 'submitting…' :
    ethanJobStatus === 'processing'  ? 'reconstructing…' :
    ethanJobStatus === 'smirk-only' ? 'ethan bald (no 3D)' :
    'ethan bald';

  const ethanBaldOutline =
    ethanJobStatus === 'done'        ? '2px solid #44ffdd' :
    ethanJobStatus === 'smirk-only' ? '2px solid #ffaa44' :
    ethanJobStatus === 'error'       ? '2px solid #ff4444' :
    'none';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        shadows
        gl={{ toneMapping: THREE.NoToneMapping }}
        camera={{ position: [0, 0, 7.8], fov: 45 }}
        style={{ width: '100%', height: '100%', background: '#001f5b' }}
      >
        <Scene
          showPolycam={showPolycam}
          showSplat={showSplat}
          showFlame={showFlame}
          flameData={effectiveFlameData}
          visibleLayers={visibleLayers}
          hairScale={hairScale}
          hairPos={hairPos}
          splatScale={splatTransform?.scale ?? 2.772}
          splatPos={splatTransform?.pos ?? [0, -0.07, 0]}
          splatSrc={effectiveSplatSrc}
          smirkEuler={smirkEuler}
          onHairBBoxReady={setPlyBBox}
        />
      </Canvas>
      <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '90%', zIndex: 10, pointerEvents: 'auto' }}>
        <button onClick={() => setShowPolycam(v => !v)} style={{ ...btnStyle, opacity: showPolycam ? 1 : 0.4 }}>
          polycam
        </button>
        <button onClick={() => setShowSplat(v => !v)} style={{ ...btnStyle, opacity: showSplat ? 1 : 0.4 }}>
          gaussians
        </button>
        <button onClick={() => setShowFlame(v => !v)} style={{ ...btnStyle, opacity: showFlame ? 1 : 0.4, outline: effectiveFlameData ? '2px solid #44ffdd' : 'none' }}>
          flame
        </button>
        <button
          onClick={loadEthanBald}
          disabled={ethanJobStatus === 'submitting' || ethanJobStatus === 'processing'}
          style={{
            ...btnStyle,
            opacity: (ethanJobStatus === 'submitting' || ethanJobStatus === 'processing') ? 0.5 : 1,
            outline: ethanBaldOutline,
          }}
        >
          {ethanBaldLabel}
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
