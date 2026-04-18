'use client';

import { HairParams, UserHeadProfile } from '@/types';

import EditPanel from '@/components/EditPanel';
import FaceLiftPanel from '@/components/FaceLiftPanel';
import HairClassifierPanel from '@/components/HairClassifierPanel';
import ScanSetup from '@/components/ScanSetup';
import dynamic from 'next/dynamic';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useHairClassifier } from '@/hooks/useHairClassifier';
import { useFaceLift } from '@/hooks/useFaceLift';
import { useHairStep } from '@/hooks/useHairStep';
import { useSmirk } from '@/hooks/useSmirk';
import { useState } from 'react';

// Dynamically import HairScene (Three.js — no SSR)
const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });

export default function Home() {
  const [showSetup, setShowSetup] = useState(true);
  const [profile, setProfile] = useState<UserHeadProfile>(mockUserHeadProfile);
  const [params, setParams] = useState<HairParams>(mockUserHeadProfile.currentStyle.params);

  // Both jobs fire in parallel as soon as the scan captures a frontal snapshot.
  // imageDataUrl is undefined until a real webcam scan completes (mock profile has none).
  // HairStep receives the original photo; FaceLift baldifies it server-side before reconstructing.
  const facelift  = useFaceLift(profile.faceScanData?.imageDataUrl);
  const hairstep  = useHairStep(profile.faceScanData?.imageDataUrl);
  const smirk     = useSmirk(profile.faceScanData?.imageDataUrl);
  const classifier = useHairClassifier(profile.faceScanData);

  const handleSetupComplete = (newProfile: UserHeadProfile) => {
    setProfile(newProfile);
    setParams(newProfile.currentStyle.params);
    setShowSetup(false);
  };

  const handleParamsChange = (next: HairParams) => {
    setParams(next);
    setProfile((prev) => ({
      ...prev,
      currentStyle: { ...prev.currentStyle, params: next },
    }));
  };

  return (
    <main className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {showSetup && <ScanSetup onComplete={handleSetupComplete} />}

      {/* 3D Viewport */}
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
        />
        <HairClassifierPanel state={classifier} />
        <div className="absolute top-3 left-3 text-xs text-gray-500 pointer-events-none">
          ShapeUp · drag to rotate
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-72 border-l border-gray-800 flex-shrink-0 flex flex-col">
        <div className="p-3 border-b border-gray-800">
          <button
            onClick={() => setShowSetup(true)}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 transition-colors"
          >
            📷 Rescan Face
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <EditPanel profile={profile} onParamsChange={handleParamsChange} />
        </div>
      </div>

      {/* FaceLift reconstruction panel — appears after setup, bottom-right corner */}
      {!showSetup && (
        <FaceLiftPanel status={facelift.status} jobId={facelift.jobId} />
      )}
    </main>
  );
}
