// POST { imageDataUrl: string } → { jobId: string }
// GET  ?jobId=<id>              → { status: 'queued'|'running'|'success'|'error', error?: string }

import { NextRequest, NextResponse } from 'next/server';

const HAIRSTEP_URL = process.env.HAIRSTEP_URL ?? '';

export async function POST(req: NextRequest) {
  if (!HAIRSTEP_URL) {
    return NextResponse.json({ error: 'HAIRSTEP_URL not configured' }, { status: 503 });
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

  const upstream = await fetch(`${HAIRSTEP_URL}/process_image`, {
    method:  'POST',
    headers: { 'ngrok-skip-browser-warning': 'true' },
    body:    form,
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json({ error: `HairStep server error: ${text}` }, { status: 502 });
  }

  const data = await upstream.json();
  return NextResponse.json({ jobId: data.job_id });
}

export async function GET(req: NextRequest) {
  if (!HAIRSTEP_URL) {
    return NextResponse.json({ error: 'HAIRSTEP_URL not configured' }, { status: 503 });
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  const upstream = await fetch(`${HAIRSTEP_URL}/status/${jobId}`, {
    headers: { 'ngrok-skip-browser-warning': 'true', 'User-Agent': 'shapeup' },
  });

  const data = await upstream.json();
  return NextResponse.json(data);
}
