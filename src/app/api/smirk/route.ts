// POST { imageDataUrl: string }
// → { vertices_canonical, faces, landmarks_canonical,
//     vertices_aligned, landmarks_aligned, transform, detected_landmarks }
//
// Single-shot — returns directly, no polling needed (~0.5s on CPU).

import { NextRequest, NextResponse } from 'next/server';

const SMIRK_URL = process.env.SMIRK_URL ?? '';

export async function POST(req: NextRequest) {
  if (!SMIRK_URL) {
    return NextResponse.json({ error: 'SMIRK_URL not configured' }, { status: 503 });
  }

  const { imageDataUrl } = await req.json();
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
    return NextResponse.json({ error: 'Invalid imageDataUrl' }, { status: 400 });
  }

  const base64 = imageDataUrl.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');
  const blob   = new Blob([buffer], { type: 'image/jpeg' });

  const form = new FormData();
  form.append('image', blob, 'face.jpg');

  const upstream = await fetch(`${SMIRK_URL}/align`, {
    method:  'POST',
    headers: { 'ngrok-skip-browser-warning': 'true' },
    body:    form,
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json({ error: `SMIRK server error: ${text}` }, { status: 502 });
  }

  const data = await upstream.json();
  return NextResponse.json(data);
}
