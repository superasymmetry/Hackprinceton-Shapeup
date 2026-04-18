'use client';

import { HairParams, UserHeadProfile } from '@/types';

import EditPanel from '@/components/EditPanel';
import dynamic from 'next/dynamic';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useSmirk } from '@/hooks/useSmirk';
import { useState } from 'react';

const HairScene  = dynamic(() => import('@/components/HairScene'),  { ssr: false });
const ScanCamera = dynamic(() => import('@/components/ScanCamera'), { ssr: false });

export default function Home() {
  const [profile, setProfile] = useState<UserHeadProfile | null>(null);
  const [params,  setParams]  = useState<HairParams>(mockUserHeadProfile.currentStyle.params);

  const smirk = useSmirk(profile?.faceScanData?.imageDataUrl);

  const handleParamsChange = (next: HairParams) => {
    setParams(next);
    setProfile(prev => prev ? { ...prev, currentStyle: { ...prev.currentStyle, params: next } } : prev);
  };

  if (!profile) {
    return (
      <main className="flex h-screen bg-gray-950 items-center justify-center">
        <div className="w-96">
          <ScanCamera
            hairType="straight"
            onScanComplete={(p) => { setProfile(p); setParams(p.currentStyle.params); }}
            onDismiss={() => setProfile(mockUserHeadProfile)}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <div className="flex-1 relative">
        <HairScene
          params={params}
          colorRGB={profile.currentStyle.colorRGB}
          profile={profile}
          flameData={
            smirk.result
              ? {
                  vertices: smirk.result.vertices_canonical,
                  faces: smirk.result.faces,
                }
              : undefined
          }
          smirkTransform={smirk.result?.transform}
        />
      </div>

      {/* Sidebar */}
      <div className="w-72 border-l border-gray-800 flex-shrink-0 flex flex-col">
        <div className="flex-1 overflow-hidden">
          <EditPanel profile={profile} onParamsChange={handleParamsChange} />
        </div>
      </div>
    </main>
  );
}
