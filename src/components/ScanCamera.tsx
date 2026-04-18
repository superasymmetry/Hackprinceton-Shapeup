'use client';

// ============================================================
// ScanCamera — Face ID-style multi-phase head scan
//
// Phase flow: front → turn-left → turn-right → done
// - Front: captures width, height, crown position (30 frames)
// - Turn-left: captures head depth from left profile (15 frames)
// - Turn-right: confirms depth from right profile (15 frames)
//
// Visual: large canvas preview with face oval overlay,
// color-coded feedback, directional arrows, and progress arc.
// Auto-starts on mount — no button needed.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { FaceFrame, UserHeadProfile } from '@/types';
import { mediapipeToProfile, averageProfiles, ScanMeta } from '@/lib/mediapipeToProfile';

interface ScanCameraProps {
  hairType: 'straight' | 'wavy' | 'curly';
  onScanComplete: (profile: UserHeadProfile) => void;
  onDismiss: () => void;
}

type ScanPhase = 'loading' | 'front' | 'turn-left' | 'turn-right' | 'done' | 'error';

// Frames required per phase
const FRONT_FRAMES = 30;
const SIDE_FRAMES  = 15;

// Yaw thresholds (nose offset relative to face center in normalized coords)
const YAW_STRAIGHT  = 0.03;  // |yaw| < this → looking straight
const YAW_TURN      = 0.07;  // yaw < -this → turned left, yaw > +this → turned right

// CDN base
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe';

// ── Drawing helpers ───────────────────────────────────────────

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  phase: ScanPhase,
  collecting: boolean,
  progress: number,        // 0–1 for current phase
  faceDetected: boolean,
  phasesDone: Set<ScanPhase>
) {
  const cx   = W / 2;
  const cy   = H * 0.46;
  const rx   = W * 0.32;
  const ry   = H * 0.40;

  // Oval color
  let ovalColor = '#ef4444'; // red — no face
  if (faceDetected) {
    if (collecting) {
      ovalColor = '#3b82f6'; // blue — collecting
    } else {
      ovalColor = '#eab308'; // yellow — face found, waiting for right angle
    }
  }
  if (phase === 'done') ovalColor = '#22c55e';

  // Draw oval outline
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = ovalColor;
  ctx.lineWidth   = 3;
  ctx.stroke();

  // Progress arc around oval (sweeps clockwise as frames collected)
  if (collecting && progress > 0) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 6, ry + 6, 0, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth   = 4;
    ctx.stroke();
  }

  // Checkmarks for completed phases
  let doneX = 12;
  const phases: ScanPhase[] = ['front', 'turn-left', 'turn-right'];
  const labels = ['Front', 'Left', 'Right'];
  phases.forEach((p, i) => {
    if (phasesDone.has(p)) {
      ctx.fillStyle   = '#22c55e';
      ctx.font        = 'bold 12px sans-serif';
      ctx.fillText(`✓ ${labels[i]}`, doneX, H - 10);
    }
    doneX += 70;
  });

  // Directional arrow for turn phases
  if ((phase === 'turn-left' || phase === 'turn-right') && faceDetected && !collecting) {
    const dir = phase === 'turn-left' ? -1 : 1;
    const ax  = cx + dir * (rx + 30);
    const ay  = cy;
    const al  = 20;

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + dir * al, ay);
    ctx.moveTo(ax + dir * al, ay);
    ctx.lineTo(ax + dir * (al - 8), ay - 8);
    ctx.moveTo(ax + dir * al, ay);
    ctx.lineTo(ax + dir * (al - 8), ay + 8);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth   = 3;
    ctx.stroke();
  }
}

// ── Component ──────────────────────────────────────────────

export default function ScanCamera({ hairType, onScanComplete, onDismiss }: ScanCameraProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const maskCanvas    = useRef<HTMLCanvasElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);

  const latestLandmarks = useRef<Array<{ x: number; y: number; z: number }> | null>(null);
  const latestMask      = useRef<ImageData | null>(null);
  const animFrameId     = useRef<number | null>(null);
  const faceMeshRef     = useRef<MediaPipeFaceMesh | null>(null);
  const segRef          = useRef<MediaPipeSelfieSegmentation | null>(null);
  const activeRef       = useRef(false);

  // Snapshot taken mid-way through the front phase — guaranteed frontal,
  // used for the face mesh instead of latestLandmarks (which by scan-end
  // are from the turn-right phase, i.e. the user looking sideways).
  const frontFaceSnapshot = useRef<{
    landmarks: FaceFrame['landmarks'];
    imageDataUrl: string;
    imageWidth: number;
    imageHeight: number;
  } | null>(null);
  const classifierSnapshots = useRef<FaceFrame[]>([]);

  // Per-phase frame buckets
  const frontProfiles     = useRef<Array<UserHeadProfile & { _meta: ScanMeta }>>([]);
  const leftDepths        = useRef<number[]>([]);
  const rightDepths       = useRef<number[]>([]);

  const [phase, setPhase]           = useState<ScanPhase>('loading');
  const phaseRef                    = useRef<ScanPhase>('loading');
  const [collecting, setCollecting] = useState(false);
  const collectingRef               = useRef(false);
  const [progress, setProgress]     = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [phasesDone, setPhasesDone] = useState<Set<ScanPhase>>(new Set());
  const [errorMsg, setErrorMsg]     = useState('');
  const [instruction, setInstruction] = useState('Preparing camera…');

  function captureFrameSnapshot(
    landmarks: Array<{ x: number; y: number; z: number }>,
    options?: { yawAbs?: number; frontFrameIndex?: number },
  ): FaceFrame | null {
    const v = videoRef.current;
    if (!v) return null;

    const snap = document.createElement('canvas');
    snap.width = v.videoWidth || 640;
    snap.height = v.videoHeight || 480;
    const sCtx = snap.getContext('2d');
    if (!sCtx) return null;

    sCtx.drawImage(v, 0, 0, snap.width, snap.height);
    let maskDataUrl: string | undefined;
    if (latestMask.current) {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = snap.width;
      maskCanvas.height = snap.height;
      const maskCtx = maskCanvas.getContext('2d');
      if (maskCtx) {
        maskCtx.putImageData(latestMask.current, 0, 0);
        maskDataUrl = maskCanvas.toDataURL('image/png');
      }
    }
    return {
      landmarks: landmarks.map((lm) => ({ ...lm })),
      imageDataUrl: snap.toDataURL('image/jpeg', 0.88),
      maskDataUrl,
      imageWidth: snap.width,
      imageHeight: snap.height,
      yawAbs: options?.yawAbs,
      frontFrameIndex: options?.frontFrameIndex,
    };
  }

  function setPhaseSync(p: ScanPhase) {
    phaseRef.current = p;
    setPhase(p);
  }

  function setCollectingSync(v: boolean) {
    collectingRef.current = v;
    setCollecting(v);
  }

  // ── Instruction text ────────────────────────────────────────

  useEffect(() => {
    if (phase === 'loading') return setInstruction('Preparing camera…');
    if (phase === 'done')    return setInstruction('Scan complete! Analyzing…');
    if (phase === 'error')   return setInstruction(errorMsg);

    const map: Record<string, string> = {
      'front-wait':       'Position your face inside the oval',
      'front-collect':    'Hold still…',
      'turn-left-wait':   'Slowly turn your head to the left',
      'turn-left-collect':'Hold there…',
      'turn-right-wait':  'Now slowly turn your head to the right',
      'turn-right-collect':'Hold there…',
    };
    const key = `${phase}-${collecting ? 'collect' : 'wait'}`;
    setInstruction(map[key] ?? '');
  }, [phase, collecting, errorMsg]);

  // ── Load MediaPipe CDN scripts ──────────────────────────────

  useEffect(() => {
    const scripts = [
      `${CDN}/face_mesh/face_mesh.js`,
      `${CDN}/selfie_segmentation/selfie_segmentation.js`,
    ];
    let loaded = 0;

    scripts.forEach((src) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        loaded++;
        if (loaded === scripts.length) startCamera();
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.crossOrigin = 'anonymous';
      el.onload = () => { loaded++; if (loaded === scripts.length) startCamera(); };
      el.onerror = () => {
        setPhaseSync('error');
        setErrorMsg('Failed to load MediaPipe. Check your connection.');
      };
      document.head.appendChild(el);
    });

    return () => {
      activeRef.current = false;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      faceMeshRef.current?.close();
      segRef.current?.close();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── Camera + MediaPipe init ─────────────────────────────────

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      await video.play();
      initMediaPipe();
    } catch {
      setPhaseSync('error');
      setErrorMsg('Camera access denied.');
    }
  }

  function initMediaPipe() {
    const FM  = window.FaceMesh;
    const SS  = window.SelfieSegmentation;
    if (!FM || !SS) {
      setPhaseSync('error');
      setErrorMsg('MediaPipe unavailable.');
      return;
    }

    const faceMesh = new FM({ locateFile: (f: string) => `${CDN}/face_mesh/${f}` });
    faceMesh.setOptions({
      maxNumFaces: 1, refineLandmarks: true,
      minDetectionConfidence: 0.7, minTrackingConfidence: 0.7,
    });
    faceMesh.onResults((r: FaceMeshResults) => {
      latestLandmarks.current = r.multiFaceLandmarks?.[0] ?? null;
    });
    faceMeshRef.current = faceMesh;

    const seg = new SS({ locateFile: (f: string) => `${CDN}/selfie_segmentation/${f}` });
    seg.setOptions({ modelSelection: 1 });
    seg.onResults((r: SegmentationResults) => {
      const canvas = maskCanvas.current;
      if (!canvas || !r.segmentationMask) return;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(r.segmentationMask as CanvasImageSource, 0, 0, 640, 480);
      latestMask.current = ctx.getImageData(0, 0, 640, 480);
    });
    segRef.current = seg;

    activeRef.current = true;
    setPhaseSync('front');
    setProgress(0);
    animFrameId.current = requestAnimationFrame(processFrame);
  }

  // ── Per-frame loop ──────────────────────────────────────────

  async function processFrame() {
    if (!activeRef.current) return;

    const video = videoRef.current;
    if (video && video.readyState >= 2) {
      try {
        await faceMeshRef.current?.send({ image: video });
        await segRef.current?.send({ image: video });
      } catch { /* model warming up */ }
    }

    const lms  = latestLandmarks.current;
    const mask = latestMask.current;
    const face = !!lms;
    setFaceDetected(face);

    if (face && lms) {
      // Yaw: nose tip x relative to midpoint between ears
      const noseTip  = lms[1];
      const earMidX  = (lms[234].x + lms[454].x) / 2;
      const yaw      = noseTip.x - earMidX;
      const curPhase = phaseRef.current;

      if (curPhase === 'front') {
        const straight = Math.abs(yaw) < YAW_STRAIGHT;
        if (straight && mask) {
          if (!collectingRef.current) setCollectingSync(true);
          try {
            const profile = mediapipeToProfile({
              landmarks: lms, segmentationMask: mask,
              hairType, imageWidth: 640, imageHeight: 480,
            });
            frontProfiles.current.push(profile);
            const collected = frontProfiles.current.length;
            setProgress(collected / FRONT_FRAMES);

            // Capture the frontal snapshot mid-way through collection.
            // At this point yaw has already passed the straight check so the
            // user is confirmed looking forward — this avoids using latestLandmarks
            // at scan-end (which are from the sideways turn-right phase).
            const snapAt = Math.floor(FRONT_FRAMES / 2);
            const ensembleStride = Math.max(1, Math.floor(FRONT_FRAMES / 10));
            if (collected % ensembleStride === 0 && classifierSnapshots.current.length < 10) {
              const frame = captureFrameSnapshot(lms, {
                yawAbs: Math.abs(yaw),
                frontFrameIndex: collected,
              });
              if (frame) classifierSnapshots.current.push(frame);
            }
            if (collected === snapAt && !frontFaceSnapshot.current) {
              const frame = captureFrameSnapshot(lms, {
                yawAbs: Math.abs(yaw),
                frontFrameIndex: collected,
              });
              if (frame) {
                frontFaceSnapshot.current = frame;
              }
            }

            if (collected >= FRONT_FRAMES) {
              setCollectingSync(false);
              setPhasesDone(prev => new Set(prev).add('front'));
              setProgress(0);
              setPhaseSync('turn-left');
            }
          } catch { /* bad frame */ }
        } else {
          if (collectingRef.current) setCollectingSync(false);
        }
      }

      else if (curPhase === 'turn-left') {
        const turnedLeft = yaw < -YAW_TURN;
        if (turnedLeft) {
          if (!collectingRef.current) setCollectingSync(true);
          // Head depth estimate: distance from nose to far (right) ear in X
          // At ~45° turn, this ≈ the depth of the head
          const noseX = lms[1].x * 640;
          const farEarX = lms[454].x * 640; // right ear is now the far side
          leftDepths.current.push(Math.abs(farEarX - noseX));
          setProgress(leftDepths.current.length / SIDE_FRAMES);

          if (leftDepths.current.length >= SIDE_FRAMES) {
            setCollectingSync(false);
            setPhasesDone(prev => new Set(prev).add('turn-left'));
            setProgress(0);
            setPhaseSync('turn-right');
          }
        } else {
          if (collectingRef.current) setCollectingSync(false);
        }
      }

      else if (curPhase === 'turn-right') {
        const turnedRight = yaw > YAW_TURN;
        if (turnedRight) {
          if (!collectingRef.current) setCollectingSync(true);
          const noseX   = lms[1].x * 640;
          const farEarX = lms[234].x * 640; // left ear is now the far side
          rightDepths.current.push(Math.abs(farEarX - noseX));
          setProgress(rightDepths.current.length / SIDE_FRAMES);

          if (rightDepths.current.length >= SIDE_FRAMES) {
            setCollectingSync(false);
            setPhasesDone(prev => new Set(prev).add('turn-right'));
            setPhaseSync('done');
            finalizeScan();
            return;
          }
        } else {
          if (collectingRef.current) setCollectingSync(false);
        }
      }
    }

    drawFrame();
    animFrameId.current = requestAnimationFrame(processFrame);
  }

  // ── Finalize and emit profile ───────────────────────────────

  function finalizeScan() {
    activeRef.current = false;

    const averaged = averageProfiles(frontProfiles.current);

    // Average head depth from both side scans and apply to Z anchors
    const allDepths = [...leftDepths.current, ...rightDepths.current];
    if (allDepths.length > 0 && frontProfiles.current.length > 0) {
      const avgDepthPx = allDepths.reduce((a, b) => a + b, 0) / allDepths.length;
      const pxToScene  = frontProfiles.current[0]._meta.pxToScene;
      const depthScene = avgDepthPx * pxToScene;
      averaged.anchors.earLeft[2]  = -depthScene * 0.5;
      averaged.anchors.earRight[2] = -depthScene * 0.5;
    }

    // Use the frontal snapshot captured mid-way through the front phase.
    // latestLandmarks at this point are from the turn-right phase (user
    // looking sideways), so we must NOT use them for the face mesh.
    const primaryFrame = frontFaceSnapshot.current ?? classifierSnapshots.current[0] ?? null;
    if (primaryFrame) {
      averaged.faceScanData = {
        ...primaryFrame,
        classifierFrames: classifierSnapshots.current,
      };
    }

    onScanComplete(averaged);
  }

  // ── Draw mirrored frame + overlay ──────────────────────────

  function drawFrame() {
    const video  = videoRef.current;
    const canvas = previewCanvas.current;
    if (!video || !canvas) return;
    const W   = canvas.width;   // 640
    const H   = canvas.height;  // 640
    const ctx = canvas.getContext('2d')!;

    // Video is 640×480 — crop vertically to center a 480×480 square,
    // then scale up to fill the 640×640 canvas.
    const vW = video.videoWidth  || 640;
    const vH = video.videoHeight || 480;
    const cropSize = Math.min(vW, vH);          // 480
    const cropX    = (vW - cropSize) / 2;       // 80 (center horizontally)
    const cropY    = (vH - cropSize) / 2;       // 0

    // Mirror the feed
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, W, H);
    ctx.restore();

    drawOverlay(ctx, W, H, phaseRef.current, collectingRef.current, progress, faceDetected, phasesDone);
  }

  // ── Render ──────────────────────────────────────────────────

  const phaseLabel =
    phase === 'front'      ? 'Step 1 of 3 — Face Forward' :
    phase === 'turn-left'  ? 'Step 2 of 3 — Turn Left'    :
    phase === 'turn-right' ? 'Step 3 of 3 — Turn Right'   :
    phase === 'done'       ? 'Complete'                    : '';

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Hidden helpers */}
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={maskCanvas} width={640} height={480} className="hidden" />

      {/* Step label */}
      {phaseLabel && (
        <p className="text-xs text-gray-400 uppercase tracking-widest">{phaseLabel}</p>
      )}

      {/* Large preview canvas — 1:1 square */}
      <div className="relative w-full rounded-2xl overflow-hidden bg-gray-800" style={{ aspectRatio: '1/1' }}>
        <canvas
          ref={previewCanvas}
          width={640}
          height={640}
          className="w-full h-full object-cover"
        />
        {phase === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            Loading camera…
          </div>
        )}
        {phase === 'done' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
            <span className="text-green-400 text-xl font-semibold">Done</span>
          </div>
        )}
      </div>

      {/* Instruction text */}
      <p className="text-sm text-white text-center min-h-[1.5rem]">{instruction}</p>

      {/* Dismiss link */}
      {(phase === 'loading' || phase === 'error' || phase === 'front') && (
        <button
          onClick={onDismiss}
          className="text-xs text-gray-500 underline mt-1"
        >
          Skip camera scan
        </button>
      )}
    </div>
  );
}
