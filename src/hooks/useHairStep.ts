import { useEffect, useRef, useState } from 'react';

export type HairStepStatus = 'idle' | 'submitting' | 'processing' | 'done' | 'error';

export interface HairStepState {
  status: HairStepStatus;
  jobId:  string | null;
  error:  string | null;
}

const POLL_INTERVAL_MS = 10_000;

export function useHairStep(imageDataUrl: string | undefined): HairStepState {
  const [state, setState] = useState<HairStepState>({ status: 'idle', jobId: null, error: null });
  const submittedRef      = useRef(false);
  const pollTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // Submit original photo to HairStep when image first becomes available
  useEffect(() => {
    if (!imageDataUrl || submittedRef.current) return;
    submittedRef.current = true;

    setState({ status: 'submitting', jobId: null, error: null });

    fetch('/api/hairstep', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ imageDataUrl }),
    })
      .then(r => r.json())
      .then((data: { jobId?: string; error?: string }) => {
        if (data.jobId) {
          setState({ status: 'processing', jobId: data.jobId, error: null });
        } else {
          setState({ status: 'error', jobId: null, error: data.error ?? 'Submit failed' });
        }
      })
      .catch(e => setState({ status: 'error', jobId: null, error: String(e) }));
  }, [imageDataUrl]);

  // Poll for completion once we have a jobId
  useEffect(() => {
    if (state.status !== 'processing' || !state.jobId) return;

    const jobId = state.jobId;
    pollTimerRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/hairstep?jobId=${jobId}`);
        const data = await res.json() as { status: string; error?: string };
        if (data.status === 'success') {
          clearInterval(pollTimerRef.current!);
          setState(s => ({ ...s, status: 'done' }));
        } else if (data.status === 'error') {
          clearInterval(pollTimerRef.current!);
          setState(s => ({ ...s, status: 'error', error: data.error ?? 'Processing failed' }));
        }
      } catch {
        // transient network error — keep polling
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [state.status, state.jobId]);

  return state;
}
