import { FaceFrame, FaceScanData } from '@/types';

const OUTPUT_SIZE = 320;
const MAX_FRAMES = 3;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeCrop(frame: FaceFrame) {
  const points = frame.landmarks.map((lm) => ({
    x: lm.x * frame.imageWidth,
    y: lm.y * frame.imageHeight,
  }));

  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));

  const faceW = Math.max(1, maxX - minX);
  const faceH = Math.max(1, maxY - minY);

  const expandedLeft = minX - faceW * 0.45;
  const expandedRight = maxX + faceW * 0.45;
  const expandedTop = minY - faceH * 0.95;
  const expandedBottom = maxY + faceH * 0.20;

  const cropW = expandedRight - expandedLeft;
  const cropH = expandedBottom - expandedTop;
  const side = Math.max(cropW, cropH);

  const centerX = (expandedLeft + expandedRight) / 2;
  const centerY = (expandedTop + expandedBottom) / 2 - faceH * 0.05;

  const x = clamp(centerX - side / 2, 0, Math.max(0, frame.imageWidth - side));
  const y = clamp(centerY - side / 2, 0, Math.max(0, frame.imageHeight - side));
  const size = clamp(side, 1, Math.min(frame.imageWidth, frame.imageHeight));

  return { x, y, size };
}

function loadImage(imageDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load classifier frame'));
    img.src = imageDataUrl;
  });
}

async function cropFrame(frame: FaceFrame): Promise<string> {
  const img = await loadImage(frame.imageDataUrl);
  const { x, y, size } = computeCrop(frame);

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create classifier canvas context');
  }

  ctx.drawImage(img, x, y, size, size, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function rankFrame(frame: FaceFrame): number {
  const yawPenalty = (frame.yawAbs ?? 1) * 10;
  const centerPenalty = Math.abs((frame.frontFrameIndex ?? 0) - 15) * 0.08;
  return yawPenalty + centerPenalty;
}

export async function buildClassifierImageBatch(
  faceScanData: FaceScanData | undefined,
): Promise<string[]> {
  if (!faceScanData) return [];

  const rawFrames: FaceFrame[] = [
    ...(faceScanData.classifierFrames ?? []),
    {
      landmarks: faceScanData.landmarks,
      imageDataUrl: faceScanData.imageDataUrl,
      maskDataUrl: faceScanData.maskDataUrl,
      imageWidth: faceScanData.imageWidth,
      imageHeight: faceScanData.imageHeight,
    },
  ];

  const deduped = rawFrames.filter(
    (frame, index, frames) =>
      frames.findIndex((candidate) => candidate.imageDataUrl === frame.imageDataUrl) === index,
  );

  const selected = deduped
    .sort((a, b) => rankFrame(a) - rankFrame(b))
    .slice(0, MAX_FRAMES);
  if (selected.length === 0) return [];

  return Promise.all(selected.map(cropFrame));
}
