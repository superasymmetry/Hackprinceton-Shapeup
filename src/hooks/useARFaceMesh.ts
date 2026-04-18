// Fetches the latest TrueDepth face mesh from /api/face-mesh.
// Returns null until a mesh has been POSTed by the iOS capture app.
import { useState, useEffect } from 'react';
import { ARFaceMesh } from '@/types';

export function useARFaceMesh(): ARFaceMesh | null {
  const [mesh, setMesh] = useState<ARFaceMesh | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/face-mesh');
        if (res.ok && !cancelled) {
          const data: ARFaceMesh | null = await res.json();
          if (data) setMesh(prev =>
            prev?.capturedAt === data.capturedAt ? prev : data
          );
        }
      } catch {
        // server not ready yet — ignore
      }
    }

    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return mesh;
}
