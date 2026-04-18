'use client';

import { HairParams, UserHeadProfile } from '@/types';

import EditPanel from '@/components/EditPanel';
import ScanSetup from '@/components/ScanSetup';
import dynamic from 'next/dynamic';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useState } from 'react';

// Dynamically import HairScene (Three.js — no SSR)
const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });

export default function Home() {
  const [showSetup, setShowSetup] = useState(true);
  const [profile, setProfile] = useState<UserHeadProfile>(mockUserHeadProfile);
  const [params, setParams] = useState<HairParams>(mockUserHeadProfile.currentStyle.params);

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
      Hello

    </main>
  );
}
