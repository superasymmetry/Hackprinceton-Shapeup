// ============================================================
// POST /api/summary — Output Phase endpoint
//
// Body: { profile: UserHeadProfile, params: HairParams }
// Response: { summary: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export async function POST(req: NextRequest) {
  const { profile, params } = await req.json();

  if (!profile || !params) {
    return NextResponse.json({ error: 'Missing profile or params' }, { status: 400 });
  }

  const system = `You are a professional barber assistant. Given a client's hair profile and desired style parameters, write a concise barber instruction card. Output 5–8 bullet points a barber can follow. Be specific with lengths, techniques, and product suggestions. Do NOT use markdown headers — just bullet points starting with "•".`;

  const message = `Client profile:
- Hair type: ${profile.currentStyle.hairType}
- Current preset: ${profile.currentStyle.preset}

Desired style parameters (0.0 = none, 2.0 = maximum for lengths; 0.0–1.0 for others):
- Top length: ${params.topLength.toFixed(2)}
- Side length: ${params.sideLength.toFixed(2)}
- Back length: ${params.backLength.toFixed(2)}
- Messiness/texture: ${params.messiness.toFixed(2)}
- Taper: ${params.taper.toFixed(2)}

Write the barber instruction card now.`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gemini-3.1-flash-lite-preview',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[/api/summary] Gemini error:', err);
      return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
    }

    const data = await response.json();
    const summary = data.choices[0].message.content as string;

    return NextResponse.json({ summary });
  } catch (err) {
    console.error('[/api/summary]', err);
    return NextResponse.json({ error: 'Summary request failed' }, { status: 500 });
  }
}
