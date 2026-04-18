'use client';

import { HairClassifierState } from '@/hooks/useHairClassifier';

interface HairClassifierPanelProps {
  state: HairClassifierState;
}

function formatStyleId(styleId: string): string {
  if (styleId === 'unknown_or_ambiguous') return 'Unknown / Ambiguous';
  return styleId
    .replace(/^style_\d+_/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function HairClassifierPanel({ state }: HairClassifierPanelProps) {
  if (state.status === 'idle') return null;

  const isAmbiguous =
    state.status === 'done' &&
    state.result &&
    state.result.top1_style_id === 'unknown_or_ambiguous';

  return (
    <div className="absolute top-3 right-3 z-20 w-72 rounded-2xl border border-white/10 bg-black/70 p-4 backdrop-blur">
      <p className="text-[11px] uppercase tracking-[0.2em] text-blue-300">
        Hair Classifier Demo
      </p>

      {state.status === 'submitting' && (
        <p className="mt-2 text-sm text-gray-200">Classifying captured photo…</p>
      )}

      {state.status === 'error' && (
        <p className="mt-2 text-sm text-red-300">{state.error}</p>
      )}

      {state.status === 'done' && state.result && (
        <>
          <p className="mt-2 text-xl font-semibold text-white">
            {formatStyleId(state.result.top1_style_id)}
          </p>
          {isAmbiguous && (
            <p className="mt-1 text-xs text-amber-300">
              Best guess: {formatStyleId(state.result.raw_top1_style_id)}
            </p>
          )}
          <p className="mt-1 text-sm text-gray-300">
            Confidence {(state.result.top1_confidence * 100).toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Using {state.result.frames_used} frame{state.result.frames_used === 1 ? '' : 's'}
          </p>
          <div className="mt-3 space-y-1 text-xs text-gray-300">
            {state.result.topk.map(([styleId, confidence]) => (
              <div key={styleId} className="flex items-center justify-between">
                <span>{formatStyleId(styleId)}</span>
                <span>{(confidence * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
