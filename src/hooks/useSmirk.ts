import { useEffect, useRef, useState } from 'react';

export interface SmirkTransform {
  scale:       number;
  rotation:    number[][];   // 3×3
  translation: number[];     // 3
}

export interface SmirkResult {
  vertices_canonical:  number[][];   // 5023×3, FLAME space (~0.1 m)
  faces:               number[][];   // triangles
  landmarks_canonical: number[][];   // 68×3, FLAME space
  vertices_aligned:    number[][];   // 5023×3, image space (Procrustes)
  landmarks_aligned:   number[][];   // 68×3, image space
  transform:           SmirkTransform;
  detected_landmarks:  number[][];   // 68×3, raw face_alignment output
}

export type SmirkStatus = 'idle' | 'loading' | 'done' | 'error';

export interface SmirkState {
  status: SmirkStatus;
  result: SmirkResult | null;
  error:  string | null;
}

export function useSmirk(imageDataUrl: string | undefined): SmirkState {
  const [state, setState] = useState<SmirkState>({ status: 'idle', result: null, error: null });
  const firedRef = useRef(false);

  useEffect(() => {
    if (!imageDataUrl || firedRef.current) return;
    firedRef.current = true;

    setState({ status: 'loading', result: null, error: null });

    fetch('/api/smirk', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ imageDataUrl }),
    })
      .then(r => r.json())
      .then((data: SmirkResult & { error?: string }) => {
        if (data.error) {
          setState({ status: 'error', result: null, error: data.error });
        } else {
          setState({ status: 'done', result: data, error: null });
        }
      })
      .catch(e => setState({ status: 'error', result: null, error: String(e) }));
  }, [imageDataUrl]);

  return state;
}
