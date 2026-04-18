'use client';

import { HairParams, UserHeadProfile } from '@/types';

import EditPanel from '@/components/EditPanel';
import FaceLiftPanel from '@/components/FaceLiftPanel';
import ScanSetup from '@/components/ScanSetup';
import dynamic from 'next/dynamic';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useFaceLift } from '@/hooks/useFaceLift';
import { useState } from 'react';

// Dynamically import HairScene (Three.js — no SSR)
const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });

export default function Home() {
  const [showSetup, setShowSetup] = useState(false);
  const [profile, setProfile] = useState<UserHeadProfile>(mockUserHeadProfile);
  const [params, setParams] = useState<HairParams>(mockUserHeadProfile.currentStyle.params);

  // Kick off FaceLift as soon as the scan captures a frontal snapshot.
  // imageDataUrl is undefined until a real webcam scan completes (mock profile has none).
  const facelift = useFaceLift(profile.faceScanData?.imageDataUrl);

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
        <HairScene params={params} colorRGB={profile.currentStyle.colorRGB} profile={profile} />
        <div className="absolute top-3 left-3 text-xs text-gray-500 pointer-events-none">
          ShapeUp · drag to rotate
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-72 border-l border-gray-800 flex-shrink-0">
        <EditPanel profile={profile} onParamsChange={handleParamsChange} />
      </div>

      {/* FaceLift reconstruction panel — appears after setup, bottom-right corner */}
      {!showSetup && (
        <FaceLiftPanel status={facelift.status} jobId={facelift.jobId} />
      )}
    </main>
  );
}
