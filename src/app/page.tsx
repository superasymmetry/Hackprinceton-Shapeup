'use client';

import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';

import EditPanel from '@/components/EditPanel';
import HairEditLoop from '@/components/HairEditLoop';
import dynamic from 'next/dynamic';
import { buildHairMeasurementSnapshot, ensureMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useSmirk } from '@/hooks/useSmirk';
import { useCallback, useState } from 'react';

const HairScene  = dynamic(() => import('@/components/HairScene'),  { ssr: false });
const ScanCamera = dynamic(() => import('@/components/ScanCamera'), { ssr: false });

type AppState = 'scan' | 'hairEditLoop' | '3d';
type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;

export default function Home() {
  const [appState, setAppState] = useState<AppState>('scan');
  const [profile, setProfile]   = useState<UserHeadProfile | null>(null);
  const [params,  setParams]    = useState<HairParams>(mockUserHeadProfile.currentStyle.params);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [imageUrl,  setImageUrl]    = useState<string | null>(null);
  const [baldifiedDataUrl, setBaldifiedDataUrl] = useState<string | null>(null);
  const [faceliftPlyReady, setFaceliftPlyReady] = useState(false);

  const smirk = useSmirk(profile?.faceScanData?.imageDataUrl);

  const handleParamsChange = useCallback((next: HairParams) => {
    setParams(next);
    setProfile(prev => prev ? {
      ...prev,
      currentStyle: { ...prev.currentStyle, params: next },
      measurementSnapshot: buildHairMeasurementSnapshot({
        source: 'derived_params',
        baselineMeasurements: prev.hairMeasurements,
        params: next,
        revision: (prev.measurementSnapshot?.revision ?? 0) + 1,
        bbox: prev.measurementSnapshot?.bbox,
      }),
    } : prev);
  }, []);

  const handleScanComplete = (p: UserHeadProfile, sid: string | null, url: string | null) => {
    const profileWithMeasurements = ensureMeasurementSnapshot(p);
    setProfile(profileWithMeasurements);
    setParams(profileWithMeasurements.currentStyle.params);
    if (sid && url) {
      setSessionId(sid);
      setImageUrl(url);
      setAppState('hairEditLoop');
    } else {
      // Fallback: no Firebase session — go straight to 3D
      setAppState('3d');
    }
  };

  const handleHairBBoxReady = useCallback((bbox: RawHairBBox) => {
    setProfile(prev => prev ? {
      ...prev,
      measurementSnapshot: buildHairMeasurementSnapshot({
        source: 'mesh_bbox',
        baselineMeasurements: prev.hairMeasurements,
        params: prev.currentStyle.params,
        revision: (prev.measurementSnapshot?.revision ?? 0) + 1,
        bbox,
      }),
    } : prev);
  }, []);

  if (appState === 'scan') {
    return (
      <main className="flex h-screen bg-gray-950 items-center justify-center">
        <div className="w-96">
          <ScanCamera
            hairType="straight"
            onScanComplete={handleScanComplete}
            onDismiss={() => {
              setProfile(mockUserHeadProfile);
              setAppState('3d');
            }}
          />
        </div>
      </main>
    );
  }

  if (appState === 'hairEditLoop' && sessionId && imageUrl) {
    return (
      <HairEditLoop
        sessionId={sessionId}
        initialImageUrl={imageUrl}
        onContinueTo3D={() => {
          setBaldifiedDataUrl(null);
          setFaceliftPlyReady(false);
          setAppState('3d');
        }}
        onRenderIn3D={(dataUrl) => {
          setBaldifiedDataUrl(dataUrl);
          setFaceliftPlyReady(true);
          setAppState('3d');
        }}
      />
    );
  }

  // 3D scene fallback
  return (
    <main className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <div className="flex-1 relative">
        <HairScene
          params={params}
          colorRGB={profile?.currentStyle.colorRGB ?? '#3b1f0a'}
          profile={profile ?? mockUserHeadProfile}
          onPrimaryHairBBoxReady={handleHairBBoxReady}
          autoFaceliftDataUrl={baldifiedDataUrl ?? undefined}
          faceliftPlyReady={faceliftPlyReady}
          flameData={
            smirk.result
              ? {
                  vertices: smirk.result.vertices_canonical,
                  faces: smirk.result.faces,
                }
              : undefined
          }
        />
      </div>

      <div className="w-72 border-l border-gray-800 flex-shrink-0 flex flex-col">
        <div className="p-3 border-b border-gray-800">
          <button
            onClick={() => setAppState('scan')}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 transition-colors"
          >
            📷 Rescan Face
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <EditPanel profile={profile ?? mockUserHeadProfile} onParamsChange={handleParamsChange} />
        </div>
      </div>
    </main>
  );
}
