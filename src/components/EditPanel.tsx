// ============================================================
// EditPanel — ETHAN's domain
//
// Sidebar UI for:
//   1. Manual sliders (dev/debug)
//   2. Natural language prompt → LLM edit
//   3. Undo/redo stack
// ============================================================

'use client';

import { useState, useCallback, useRef } from 'react';
import { HairParams, UserHeadProfile } from '@/types';
import { useLLM } from '@/hooks/useLLM';

interface EditPanelProps {
  profile: UserHeadProfile;
  onParamsChange: (params: HairParams) => void;
}

export default function EditPanel({ profile, onParamsChange }: EditPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<HairParams[]>([profile.currentStyle.params]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const { editHair, loading, error } = useLLM(profile);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  const currentParams = history[historyIndex];

  const pushParams = useCallback(
    (next: HairParams) => {
      // Truncate redo stack on new change
      const newHistory = [...history.slice(0, historyIndex + 1), next];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      onParamsChange(next);
    },
    [history, historyIndex, onParamsChange]
  );

  const handleSlider = (key: keyof HairParams, value: number) => {
    pushParams({ ...currentParams, [key]: value });
  };

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    const result = await editHair(prompt);
    if (result) {
      pushParams(result.params);
      setPrompt('');
    }
  };

  const undo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      onParamsChange(prev);
    }
  };

  const handleGetSummary = async () => {
    setSummaryLoading(true);
    setSummary(null);
    try {
      const res = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, params: currentParams }),
      });
      const data = await res.json();
      setSummary(data.summary ?? data.error ?? 'Something went wrong');
    } catch {
      setSummary('Failed to generate summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleCopySummary = () => {
    if (summary) navigator.clipboard.writeText(summary);
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      onParamsChange(next);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 bg-gray-900 text-white h-full overflow-y-auto">
      <h2 className="text-lg font-semibold">Edit Hair</h2>

      {/* LLM Prompt */}
      <form onSubmit={handlePromptSubmit} className="flex flex-col gap-2">
        <label className="text-sm text-gray-400">Describe the style</label>
        <textarea
          className="bg-gray-800 rounded p-2 text-sm resize-none h-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder='e.g. "Give me a messy taper fade"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded px-4 py-2 text-sm font-medium transition-colors"
        >
          {loading ? 'Styling…' : 'Apply Style'}
        </button>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </form>

      {/* Undo / Redo */}
      <div className="flex gap-2">
        <button
          onClick={undo}
          disabled={historyIndex === 0}
          className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded px-3 py-1 text-sm"
        >
          ← Undo
        </button>
        <button
          onClick={redo}
          disabled={historyIndex === history.length - 1}
          className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded px-3 py-1 text-sm"
        >
          Redo →
        </button>
      </div>

      {/* Manual sliders */}
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest">Manual Overrides</p>

        {(
          [
            { key: 'topLength',  label: 'Top Length',   min: 0, max: 2, step: 0.05 },
            { key: 'sideLength', label: 'Side Length',  min: 0, max: 2, step: 0.05 },
            { key: 'backLength', label: 'Back Length',  min: 0, max: 2, step: 0.05 },
            { key: 'messiness',  label: 'Messiness',    min: 0, max: 1, step: 0.05 },
            { key: 'taper',      label: 'Taper',        min: 0, max: 1, step: 0.05 },
          ] as const
        ).map(({ key, label, min, max, step }) => (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="text-gray-400">{currentParams[key].toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={currentParams[key]}
              onChange={(e) => handleSlider(key, parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>
        ))}
      </div>

      {/* Barber Summary */}
      <div className="flex flex-col gap-2 pt-4 border-t border-gray-700">
        <button
          onClick={handleGetSummary}
          disabled={summaryLoading}
          className="bg-green-700 hover:bg-green-600 disabled:bg-gray-600 rounded px-4 py-2 text-sm font-medium transition-colors"
        >
          {summaryLoading ? 'Generating…' : 'Get Barber Summary'}
        </button>
        {summary && (
          <div className="flex flex-col gap-1">
            <textarea
              ref={summaryRef}
              readOnly
              value={summary}
              className="bg-gray-800 rounded p-2 text-xs text-gray-200 resize-none h-36 focus:outline-none"
            />
            <button
              onClick={handleCopySummary}
              className="bg-gray-700 hover:bg-gray-600 rounded px-3 py-1 text-xs"
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </div>

      {/* Current preset badge */}
      <div className="mt-auto pt-4 border-t border-gray-700 text-xs text-gray-400">
        Preset: <span className="text-white font-medium">{profile.currentStyle.preset}</span>
        {' · '}
        Hair type: <span className="text-white font-medium">{profile.currentStyle.hairType}</span>
      </div>
    </div>
  );
}
