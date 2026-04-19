'use client';

import { useState } from 'react';
import Image from 'next/image';

interface HairEditLoopProps {
  sessionId: string;
  initialImageUrl: string;
  onRenderIn3D: (baldifiedDataUrl: string) => void;
}

export default function HairEditLoop({ sessionId, initialImageUrl, onRenderIn3D }: HairEditLoopProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState(initialImageUrl);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isBaldifying, setIsBaldifying] = useState(false);
  const [faceliftStatus, setFaceliftStatus] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/gemini-hair-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: currentImageUrl, prompt: prompt.trim(), sessionId }),
      });
      const data = await res.json();
      if (data.ok && data.newImageUrl) {
        setCurrentImageUrl(data.newImageUrl);
        setPrompt('');
      } else {
        alert('Error: ' + (data.error ?? 'Unknown error'));
      }
    } catch (err) {
      alert('Request failed: ' + String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRenderIn3D = async () => {
    if (isBaldifying || isLoading) return;
    setIsBaldifying(true);
    setFaceliftStatus('Baldifying…');
    try {
      // Step 1: baldify
      const baldRes = await fetch('/api/baldify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: currentImageUrl }),
      });
      const baldData = await baldRes.json();
      if (!baldData.baldifiedDataUrl) throw new Error(baldData.error ?? 'No image returned');

      // Step 2: submit facelift job
      setFaceliftStatus('Submitting 3D job…');
      const submitRes = await fetch('/api/facelift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: baldData.baldifiedDataUrl }),
      });
      const submitData = await submitRes.json();
      if (!submitData.jobId) throw new Error(submitData.error ?? 'No job ID returned');

      // Step 3: poll until done
      setFaceliftStatus('Generating 3D model… (this takes ~2 min)');
      const jobId = submitData.jobId;
      while (true) {
        await new Promise(r => setTimeout(r, 5000));
        const pollRes = await fetch(`/api/facelift?jobId=${jobId}`);
        const pollData = await pollRes.json();
        if (pollData.status === 'success') break;
        if (pollData.status === 'error') throw new Error(pollData.error ?? 'Facelift job failed');
      }

      onRenderIn3D(baldData.baldifiedDataUrl);
    } catch (err) {
      alert('Failed to render in 3D: ' + String(err));
      setFaceliftStatus(null);
    } finally {
      setIsBaldifying(false);
    }
  };

  return (
    <main className="flex flex-col items-center min-h-screen bg-gray-950 text-white p-6 gap-6">
      <h1 className="text-2xl font-bold tracking-tight">ShapeUp — Hair Preview</h1>

      <div className="relative w-full max-w-md aspect-[3/4] rounded-2xl overflow-hidden border border-gray-800 shadow-xl">
        <Image
          src={currentImageUrl}
          alt="Hair preview"
          fill
          className="object-cover"
          unoptimized
        />
        {isLoading && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-300">Styling your hair…</span>
          </div>
        )}
      </div>

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

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={isLoading || !prompt.trim()}
            className="flex-1 bg-white text-gray-950 font-semibold rounded-xl px-4 py-3 text-sm hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Generating…' : 'Submit'}
          </button>

          <button
            onClick={handleRenderIn3D}
            disabled={isLoading || isBaldifying}
            className="flex-1 bg-gray-800 text-white font-semibold rounded-xl px-4 py-3 text-sm hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isBaldifying ? (faceliftStatus ?? 'Processing…') : 'Render in 3D'}
          </button>
        </div>
      </div>
    </main>
  );
}
