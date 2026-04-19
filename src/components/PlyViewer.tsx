'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { parsePLY, parseGaussianWithColors } from '@/lib/parsePLY';

interface PlyViewerProps {
  plyUrl: string;
}

interface Transform {
  scale: number;
  rotX: number; // degrees
  rotY: number;
  rotZ: number;
  posX: number;
  posY: number;
  posZ: number;
}

const DEG = Math.PI / 180;

function HairMesh({ geometry, t }: { geometry: THREE.BufferGeometry; t: Transform }) {
  return (
    <group
      scale={[t.scale, t.scale, t.scale]}
      rotation={[t.rotX * DEG, t.rotY * DEG, t.rotZ * DEG]}
      position={[t.posX, t.posY, t.posZ]}
    >
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#3b1f0a" />
      </lineSegments>
    </group>
  );
}

function HeadPoints({ geometry, t }: { geometry: THREE.BufferGeometry; t: Transform }) {
  return (
    <group
      scale={[t.scale, t.scale, t.scale]}
      rotation={[t.rotX * DEG, t.rotY * DEG, t.rotZ * DEG]}
      position={[t.posX, t.posY, t.posZ]}
    >
      <points geometry={geometry}>
        <pointsMaterial vertexColors size={0.004} sizeAttenuation />
      </points>
    </group>
  );
}

async function loadHairPly(plyUrl: string): Promise<THREE.BufferGeometry> {
  const proxyUrl = `/api/proxy-ply?url=${encodeURIComponent(plyUrl)}`;
  const geo = await parsePLY(proxyUrl);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const idx = geo.index;
  console.log('[PlyViewer] hair — vertices:', pos?.count ?? 0, '| edges:', (idx?.count ?? 0) / 2);
  return geo;
}

async function loadHeadPly(): Promise<THREE.BufferGeometry> {
  const geo = await parseGaussianWithColors('/models/gaussians.ply', 20);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  console.log('[PlyViewer] head — sampled points:', pos?.count ?? 0);
  return geo;
}

// ── Reusable slider row ────────────────────────────────────────────────────
function Slider({
  label, value, min, max, step, color, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 w-7 text-right text-xs shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`flex-1 ${color}`}
        style={{ accentColor: color === 'accent-white' ? 'white' : '#9ca3af' }}
      />
      <span className="text-xs font-mono w-10 text-right shrink-0">{value}</span>
    </div>
  );
}

// ── Transform panel for one object ────────────────────────────────────────
function TransformPanel({
  label, t, set, accentClass, disabled,
}: {
  label: string;
  t: Transform;
  set: (fn: (prev: Transform) => Transform) => void;
  accentClass: string;
  disabled?: boolean;
}) {
  const upd = (key: keyof Transform) => (v: number) =>
    set((prev) => ({ ...prev, [key]: v }));

  return (
    <div className={`flex flex-col gap-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{label}</p>
      <Slider label="S"   value={t.scale} min={1}    max={200} step={1}   color={accentClass} onChange={upd('scale')} />
      <Slider label="rX"  value={t.rotX}  min={-180} max={180} step={1}   color={accentClass} onChange={upd('rotX')}  />
      <Slider label="rY"  value={t.rotY}  min={-180} max={180} step={1}   color={accentClass} onChange={upd('rotY')}  />
      <Slider label="rZ"  value={t.rotZ}  min={-180} max={180} step={1}   color={accentClass} onChange={upd('rotZ')}  />
      <Slider label="pX"  value={t.posX}  min={-1}   max={1}   step={0.01} color={accentClass} onChange={upd('posX')} />
      <Slider label="pY"  value={t.posY}  min={-1}   max={1}   step={0.01} color={accentClass} onChange={upd('posY')} />
      <Slider label="pZ"  value={t.posZ}  min={-1}   max={1}   step={0.01} color={accentClass} onChange={upd('posZ')} />
    </div>
  );
}

const HAIR_DEFAULT: Transform = { scale: 50, rotX: 0, rotY: 0, rotZ: 0, posX: 0, posY: -0.15, posZ: 0 };
const HEAD_DEFAULT: Transform = { scale: 10, rotX: 0, rotY: 0, rotZ: 0, posX: 0, posY: 0,     posZ: 0 };

export default function PlyViewer({ plyUrl }: PlyViewerProps) {
  const [hairGeo,     setHairGeo]     = useState<THREE.BufferGeometry | null>(null);
  const [hairLoading, setHairLoading] = useState(true);
  const [hairError,   setHairError]   = useState<string | null>(null);
  const [hairT,       setHairT]       = useState<Transform>(HAIR_DEFAULT);

  const [headGeo,     setHeadGeo]     = useState<THREE.BufferGeometry | null>(null);
  const [headLoading, setHeadLoading] = useState(true);
  const [headError,   setHeadError]   = useState<string | null>(null);
  const [headT,       setHeadT]       = useState<Transform>(HEAD_DEFAULT);

  useEffect(() => {
    if (!plyUrl) return;
    setHairLoading(true); setHairError(null); setHairGeo(null);
    loadHairPly(plyUrl)
      .then((geo) => { setHairGeo(geo); setHairLoading(false); })
      .catch((err) => { console.error('[PlyViewer] hair load error:', err); setHairError(String(err)); setHairLoading(false); });
  }, [plyUrl]);

  useEffect(() => {
    setHeadLoading(true); setHeadError(null); setHeadGeo(null);
    loadHeadPly()
      .then((geo) => { setHeadGeo(geo); setHeadLoading(false); })
      .catch((err) => { console.error('[PlyViewer] head load error:', err); setHeadError(String(err)); setHeadLoading(false); });
  }, []);

  if (hairLoading && !hairGeo) {
    return (
      <div className="w-full aspect-[3/4] rounded-2xl overflow-hidden border border-gray-800 bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading 3D model…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4">
      {hairError && <p className="text-xs text-red-400">Hair error: {hairError}</p>}
      {headError && <p className="text-xs text-yellow-500">Head error: {headError}</p>}

      {/* 3D canvas */}
      <div className="w-full aspect-[3/4] rounded-2xl overflow-hidden border border-gray-800 shadow-xl">
        <Canvas camera={{ position: [0, 0, 0.5], fov: 60 }} style={{ background: '#000000' }}>
          <OrbitControls enableDamping dampingFactor={0.05} />
          {hairGeo && <HairMesh geometry={hairGeo} t={hairT} />}
          {headGeo && <HeadPoints geometry={headGeo} t={headT} />}
        </Canvas>
      </div>

      {/* Transform controls */}
      <div className="grid grid-cols-2 gap-4 bg-gray-900 rounded-xl p-3 border border-gray-800">
        <TransformPanel label="Hair" t={hairT} set={setHairT} accentClass="accent-white" />
        <TransformPanel label="Head" t={headT} set={setHeadT} accentClass="accent-gray-400" disabled={headLoading} />
      </div>

      {/* Reset buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setHairT(HAIR_DEFAULT)}
          className="flex-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-1.5 transition-colors"
        >
          Reset hair
        </button>
        <button
          onClick={() => setHeadT(HEAD_DEFAULT)}
          className="flex-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-1.5 transition-colors"
        >
          Reset head
        </button>
      </div>
    </div>
  );
}
