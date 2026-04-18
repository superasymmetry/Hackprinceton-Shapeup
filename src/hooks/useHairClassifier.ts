import { useEffect, useRef, useState } from 'react';
import { buildClassifierImageBatch } from '@/lib/hairClassifierImage';
import { FaceScanData } from '@/types';

export type HairClassifierStatus = 'idle' | 'submitting' | 'done' | 'error';

export interface HairClassifierResult {
  top1_style_id: string;
  raw_top1_style_id: string;
  top1_confidence: number;
  topk: [string, number][];
  frames_used: number;
}

export interface HairClassifierState {
  status: HairClassifierStatus;
  result: HairClassifierResult | null;
  error: string | null;
}

export function useHairClassifier(faceScanData: FaceScanData | undefined): HairClassifierState {
  const [state, setState] = useState<HairClassifierState>({
    status: 'idle',
    result: null,
    error: null,
  });
  const lastSubmittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!faceScanData) return;

    const requestKey = [
      faceScanData.imageDataUrl,
      faceScanData.classifierFrames?.length ?? 0,
    ].join(':');
    if (lastSubmittedRef.current === requestKey) return;
    lastSubmittedRef.current = requestKey;

    let cancelled = false;
    setState({ status: 'submitting', result: null, error: null });

    (async () => {
      try {
        const imageDataUrls = await buildClassifierImageBatch(faceScanData);
        if (cancelled) return;

        const res = await fetch('/api/hair-classifier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrls }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? 'Hair classifier request failed');
        }
        if (cancelled) return;

        setState({ status: 'done', result: data as HairClassifierResult, error: null });
      } catch (error: unknown) {
        if (cancelled) return;
        setState({
          status: 'error',
          result: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [faceScanData]);

  return state;
}
