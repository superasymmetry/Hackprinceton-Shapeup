'use client';

import { useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';

const PlyViewer = dynamic(() => import('@/components/PlyViewer'), { ssr: false });

interface HairEditLoopProps {
  sessionId: string;
  initialImageUrl: string;
}

type LoadingPhase = 'gemini' | 'hairstep' | null;

const PHASE_LABELS: Record<NonNullable<LoadingPhase>, string> = {
  gemini:    'Styling your hair…',
  hairstep:  'Building 3D model… (~40s)',
};

export default function HairEditLoop({ sessionId, initialImageUrl }: HairEditLoopProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState(initialImageUrl);
  const [plyUrl,          setPlyUrl]          = useState<string | null>(null);
  const [prompt,          setPrompt]          = useState('');
  const [isLoading,       setIsLoading]       = useState(false);
  const [loadingPhase,    setLoadingPhase]    = useState<LoadingPhase>(null);

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;

    console.log('[HairEditLoop] submit — prompt:', prompt.trim(), '| sessionId:', sessionId);
    setIsLoading(true);

    // ── Phase 1: Gemini image edit ──────────────────────────────────────────
    setLoadingPhase('gemini');
    let newImageUrl: string;
    try {
      console.log('[HairEditLoop] calling /api/gemini-hair-edit...');
      const res = await fetch('/api/gemini-hair-edit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageUrl: currentImageUrl, prompt: prompt.trim(), sessionId }),
      });
      const data = await res.json();
      console.log('[HairEditLoop] gemini-hair-edit response:', data);

      if (!data.ok || !data.newImageUrl) {
        throw new Error(data.error ?? 'Unknown error from gemini-hair-edit');
      }
      newImageUrl = data.newImageUrl;
      console.log('[HairEditLoop] Gemini done — newImageUrl:', newImageUrl);
      setCurrentImageUrl(newImageUrl);
      setPrompt('');
    } catch (err) {
      console.error('[HairEditLoop] Gemini phase failed:', err);
      alert('Image edit failed: ' + String(err));
      setIsLoading(false);
      setLoadingPhase(null);
      return;
    }

    // ── Phase 2: HairStep 3D reconstruction ────────────────────────────────
    setLoadingPhase('hairstep');
    try {
      console.log('[HairEditLoop] calling /api/hairstep-direct with newImageUrl and sessionId:', sessionId);
      const res = await fetch('/api/hairstep-direct', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageUrl: newImageUrl, sessionId }),
      });
      const data = await res.json();
      console.log('[HairEditLoop] hairstep-direct response:', data);

      if (!data.ok || !data.plyUrl) {
        throw new Error(data.error ?? 'Unknown error from hairstep-direct');
      }
      console.log('[HairEditLoop] HairStep done — plyUrl:', data.plyUrl, '| objUrl:', data.objUrl);
      setPlyUrl(data.plyUrl);
    } catch (err) {
      console.error('[HairEditLoop] HairStep phase failed:', err);
      // Non-fatal — image was already updated, just show an alert and continue
      alert('3D build failed (image was updated): ' + String(err));
    }

    setIsLoading(false);
    setLoadingPhase(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const loadingLabel = loadingPhase ? PHASE_LABELS[loadingPhase] : '';

  return (
    <main className="flex flex-col items-center min-h-screen bg-gray-950 text-white p-6 gap-6">
      <h1 className="text-2xl font-bold tracking-tight">ShapeUp — Hair Preview</h1>

      {/* 2D image */}
      <div className="relative w-full max-w-md aspect-[3/4] rounded-2xl overflow-hidden border border-gray-800 shadow-xl">
        <Image
          src={currentImageUrl}
          alt="Hair preview"
          fill
          className="object-cover"
          unoptimized
        />
        {isLoading && loadingPhase === 'gemini' && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-300">{loadingLabel}</span>
          </div>
        )}
      </div>

      {/* 3D PLY viewer — appears after first successful HairStep response */}
      {(plyUrl || loadingPhase === 'hairstep') && (
        <div className="w-full max-w-md">
          <p className="text-xs text-gray-500 mb-2 text-center">3D Hair Model</p>
          {loadingPhase === 'hairstep' ? (
            <div className="w-full aspect-[3/4] rounded-2xl overflow-hidden border border-gray-800 bg-gray-900 flex flex-col items-center justify-center gap-3">
              <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-400">{loadingLabel}</span>
            </div>
          ) : plyUrl ? (
            <PlyViewer plyUrl={plyUrl} />
          ) : null}
        </div>
      )}

      {/* Prompt input + Submit */}
      <div className="w-full max-w-md flex flex-col gap-3">
        <textarea
          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-gray-500 transition-colors"
          rows={3}
          placeholder="Describe your haircut… (e.g. taper fade with waves on top)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />

        <button
          onClick={handleSubmit}
          disabled={isLoading || !prompt.trim()}
          className="w-full bg-white text-gray-950 font-semibold rounded-xl px-4 py-3 text-sm hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? loadingLabel : 'Submit'}
        </button>
      </div>
    </main>
  );
}
