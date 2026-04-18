'use client';

import { FaceLiftStatus } from '@/hooks/useFaceLift';

interface FaceLiftPanelProps {
  status: FaceLiftStatus;
  jobId:  string | null;
}

const STATUS_LABEL: Record<FaceLiftStatus, string> = {
  idle:        '',
  submitting:  'Submitting…',
  processing:  'Reconstructing 3D head (~3 min)',
  done:        'Reconstruction ready',
  error:       'Reconstruction failed',
};

export default function FaceLiftPanel({ status, jobId }: FaceLiftPanelProps) {
  if (status === 'idle') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-gray-900 border border-gray-700 rounded-xl p-4 w-72 shadow-2xl flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">3D Head Reconstruction</span>
        <span className="text-xs text-gray-500">FaceLift</span>
      </div>

      {(status === 'submitting' || status === 'processing') && (
        <>
          <div className="w-full h-1 rounded-full bg-gray-800 overflow-hidden">
            <div className="h-full w-1/3 bg-blue-500 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" />
          </div>
          <p className="text-xs text-gray-400">{STATUS_LABEL[status]}</p>
        </>
      )}

      {status === 'done' && jobId && (
        <>
          <video
            src={`/api/facelift/${jobId}/video`}
            autoPlay
            loop
            muted
            playsInline
            className="w-full rounded-lg aspect-square object-cover"
          />
          <a
            href={`/api/facelift/${jobId}/ply`}
            download="gaussians.ply"
            className="text-center text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-2 transition-colors"
          >
            Download gaussians.ply
          </a>
        </>
      )}

      {status === 'error' && (
        <p className="text-xs text-red-400">Failed — check FaceLift server logs.</p>
      )}
    </div>
  );
}
