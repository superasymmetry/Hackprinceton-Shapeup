import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  console.log('[gemini-hair-edit] POST received');
  console.log('[gemini-hair-edit] GEMINI_API_KEY set?', !!process.env.GEMINI_API_KEY);

  let imageUrl: string, prompt: string, sessionId: string;
  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
    prompt = body.prompt;
    sessionId = body.sessionId;
    console.log('[gemini-hair-edit] parsed body — sessionId:', sessionId, '| prompt:', prompt, '| imageUrl length:', imageUrl?.length ?? 'missing');
  } catch (err) {
    console.error('[gemini-hair-edit] failed to parse request body:', err);
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!imageUrl || !prompt || !sessionId) {
    console.error('[gemini-hair-edit] missing required fields — imageUrl:', !!imageUrl, 'prompt:', !!prompt, 'sessionId:', !!sessionId);
    return NextResponse.json({ ok: false, error: 'imageUrl, prompt, and sessionId are required' }, { status: 400 });
  }

  // Fetch the current image and convert to base64
  let base64Image: string;
  try {
    console.log('[gemini-hair-edit] fetching image from URL...');
    const imageRes = await fetch(imageUrl);
    console.log('[gemini-hair-edit] image fetch status:', imageRes.status, imageRes.statusText);
    const arrayBuffer = await imageRes.arrayBuffer();
    base64Image = Buffer.from(arrayBuffer).toString('base64');
    console.log('[gemini-hair-edit] image converted to base64, byte length:', arrayBuffer.byteLength);
  } catch (err) {
    console.error('[gemini-hair-edit] failed to fetch/convert image:', err);
    return NextResponse.json({ ok: false, error: 'Failed to fetch image', detail: String(err) }, { status: 500 });
  }

  // Call Gemini image generation model
  let newImageBase64: string;
  try {
    const modelName = 'gemini-3.1-flash-image-preview';
    console.log('[gemini-hair-edit] initializing Gemini model:', modelName);

    const model = genAI.getGenerativeModel({
      model: modelName,
      // @ts-expect-error responseModalities is valid but not yet in type defs
      generationConfig: { responseModalities: ['image', 'text'] },
    });

    const fullPrompt = `You are a professional hair stylist visualizer. Edit only the hair in this photo based on the following request: "${prompt}". Keep the face, skin, background, and all non-hair elements completely unchanged. Return the full edited portrait image.`;
    console.log('[gemini-hair-edit] sending to Gemini — prompt:', fullPrompt);

    const result = await model.generateContent([
      { inlineData: { mimeType: 'image/png', data: base64Image } },
      fullPrompt,
    ]);

    console.log('[gemini-hair-edit] Gemini responded');
    const candidates = result.response.candidates ?? [];
    console.log('[gemini-hair-edit] candidates count:', candidates.length);

    const parts = candidates[0]?.content?.parts ?? [];
    console.log('[gemini-hair-edit] parts count:', parts.length);
    parts.forEach((p, i) => {
      if ('text' in p && p.text) console.log(`[gemini-hair-edit] part[${i}] text:`, p.text);
      if ('inlineData' in p && p.inlineData) console.log(`[gemini-hair-edit] part[${i}] inlineData mimeType:`, p.inlineData.mimeType, '| data length:', (p.inlineData.data ?? '').length);
    });

    const imagePart = parts.find((p: { inlineData?: { data: string } }) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      console.error('[gemini-hair-edit] no image part found in response — full response:', JSON.stringify(result.response, null, 2));
      throw new Error('No image returned from Gemini');
    }
    newImageBase64 = imagePart.inlineData.data;
    console.log('[gemini-hair-edit] extracted image base64, length:', newImageBase64.length);
  } catch (err) {
    console.error('[gemini-hair-edit] Gemini generation error:', err);
    return NextResponse.json({ ok: false, error: 'Gemini generation failed', detail: String(err) }, { status: 500 });
  }

  // Upload new image to Firebase Storage
  let newImageUrl: string;
  try {
    const storagePath = `scans/${sessionId}/scan_${Date.now()}.png`;
    console.log('[gemini-hair-edit] uploading to Firebase Storage:', storagePath);
    const buffer = Buffer.from(newImageBase64, 'base64');
    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, buffer, { contentType: 'image/png' });
    newImageUrl = await getDownloadURL(snapshot.ref);
    console.log('[gemini-hair-edit] uploaded, newImageUrl:', newImageUrl);
  } catch (err) {
    console.error('[gemini-hair-edit] Firebase Storage upload failed:', err);
    return NextResponse.json({ ok: false, error: 'Firebase Storage upload failed', detail: String(err) }, { status: 500 });
  }

  // Append to session's images array in Firestore
  try {
    console.log('[gemini-hair-edit] appending URL to Firestore session:', sessionId);
    await updateDoc(doc(db, 'session', sessionId), {
      images: arrayUnion(newImageUrl),
    });
    console.log('[gemini-hair-edit] Firestore updated successfully');
  } catch (err) {
    console.error('[gemini-hair-edit] Firestore update failed (non-fatal):', err);
  }

  console.log('[gemini-hair-edit] done — returning newImageUrl');
  return NextResponse.json({ ok: true, newImageUrl });
}
