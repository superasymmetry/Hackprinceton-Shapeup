// POST { imageUrl: string, sessionId: string }
// → { ok: true, plyUrl: string }
//
// Sends the image to the HairStep /process endpoint (synchronous, ~40s),
// uploads the resulting PLY to Firebase Storage, and replaces the last
// null placeholder in ply_objects in Firestore.

import { NextRequest, NextResponse } from 'next/server';
import { db, storage } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Allow up to 90 seconds — HairStep takes ~40s
export const maxDuration = 90;

const HAIRSTEP_URL = process.env.HAIRSTEP_URL ?? '';

export async function POST(req: NextRequest) {
  console.log('[hairstep-direct] POST received');
  console.log('[hairstep-direct] HAIRSTEP_URL configured?', !!HAIRSTEP_URL, '—', HAIRSTEP_URL);

  if (!HAIRSTEP_URL) {
    console.error('[hairstep-direct] HAIRSTEP_URL not set in environment');
    return NextResponse.json({ ok: false, error: 'HAIRSTEP_URL not configured' }, { status: 503 });
  }

  let imageUrl: string, sessionId: string;
  try {
    const body = await req.json();
    imageUrl  = body.imageUrl;
    sessionId = body.sessionId;
    console.log('[hairstep-direct] parsed body — sessionId:', sessionId, '| imageUrl:', imageUrl?.slice(0, 80) + '...');
  } catch (err) {
    console.error('[hairstep-direct] failed to parse request body:', err);
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!imageUrl || !sessionId) {
    console.error('[hairstep-direct] missing required fields — imageUrl:', !!imageUrl, 'sessionId:', !!sessionId);
    return NextResponse.json({ ok: false, error: 'imageUrl and sessionId are required' }, { status: 400 });
  }

  // 1. Fetch image bytes from the Firebase Storage URL
  let imageBuffer: Buffer;
  try {
    console.log('[hairstep-direct] fetching image bytes from imageUrl...');
    const imageRes = await fetch(imageUrl);
    console.log('[hairstep-direct] image fetch status:', imageRes.status, imageRes.statusText);
    if (!imageRes.ok) throw new Error(`Image fetch failed with status ${imageRes.status}`);
    const arrayBuffer = await imageRes.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);
    console.log('[hairstep-direct] image fetched — byte length:', imageBuffer.length);
  } catch (err) {
    console.error('[hairstep-direct] failed to fetch image:', err);
    return NextResponse.json({ ok: false, error: 'Failed to fetch image', detail: String(err) }, { status: 500 });
  }

  // 2. POST image to HairStep /process endpoint as multipart form
  let plyBuffer: Buffer;
  try {
    console.log('[hairstep-direct] building multipart form for HairStep...');
    const form = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/png' });
    form.append('png', blob, 'hair.png');

    console.log('[hairstep-direct] POSTing to HAIRSTEP_URL:', HAIRSTEP_URL);
    const hsRes = await fetch(HAIRSTEP_URL, {
      method: 'POST',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      body: form,
    });

    console.log('[hairstep-direct] HairStep responded — status:', hsRes.status, hsRes.statusText);
    console.log('[hairstep-direct] HairStep content-type:', hsRes.headers.get('content-type'));

    if (!hsRes.ok) {
      const errText = await hsRes.text().catch(() => '(unreadable)');
      console.error('[hairstep-direct] HairStep error response:', errText);
      return NextResponse.json({ ok: false, error: `HairStep returned ${hsRes.status}`, detail: errText }, { status: 502 });
    }

    const plyArrayBuffer = await hsRes.arrayBuffer();
    plyBuffer = Buffer.from(plyArrayBuffer);
    console.log('[hairstep-direct] PLY received — byte length:', plyBuffer.length);
  } catch (err) {
    console.error('[hairstep-direct] HairStep request failed:', err);
    return NextResponse.json({ ok: false, error: 'HairStep request failed', detail: String(err) }, { status: 502 });
  }

  // 3. Upload raw PLY to Firebase Storage
  let plyUrl: string;
  const ts = Date.now();
  try {
    const plyPath = `scans/${sessionId}/hair_${ts}.ply`;
    console.log('[hairstep-direct] uploading PLY to Firebase Storage:', plyPath);
    const plyRef = ref(storage, plyPath);
    const plySnapshot = await uploadBytes(plyRef, plyBuffer, { contentType: 'application/octet-stream' });
    plyUrl = await getDownloadURL(plySnapshot.ref);
    console.log('[hairstep-direct] PLY uploaded — plyUrl:', plyUrl);
  } catch (err) {
    console.error('[hairstep-direct] PLY Firebase Storage upload failed:', err);
    return NextResponse.json({ ok: false, error: 'PLY upload failed', detail: String(err) }, { status: 500 });
  }

  // 4. Replace last null in ply_objects in Firestore
  try {
    console.log('[hairstep-direct] reading Firestore session to patch ply_objects — sessionId:', sessionId);
    const sessionSnap = await getDoc(doc(db, 'session', sessionId));
    if (!sessionSnap.exists()) {
      console.error('[hairstep-direct] session document not found:', sessionId);
      return NextResponse.json({ ok: false, error: 'Session not found' }, { status: 404 });
    }

    const data = sessionSnap.data();
    console.log('[hairstep-direct] current session data — ply_objects:', JSON.stringify(data.ply_objects));

    const plyObjects: (string | null)[] = Array.isArray(data.ply_objects) ? [...data.ply_objects] : [];
    const plyNullIdx = plyObjects.lastIndexOf(null);
    console.log('[hairstep-direct] last null index in ply_objects:', plyNullIdx);

    if (plyNullIdx !== -1) {
      plyObjects[plyNullIdx] = plyUrl;
    } else {
      plyObjects.push(plyUrl);
    }

    await updateDoc(doc(db, 'session', sessionId), { ply_objects: plyObjects });
    console.log('[hairstep-direct] Firestore updated — ply_objects:', JSON.stringify(plyObjects));
  } catch (err) {
    console.error('[hairstep-direct] Firestore patch failed (non-fatal):', err);
  }

  console.log('[hairstep-direct] done — plyUrl:', plyUrl);
  return NextResponse.json({ ok: true, plyUrl });
}
