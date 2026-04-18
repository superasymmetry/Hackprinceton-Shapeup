// ============================================================
// POST /api/edit — LLM Edit Loop endpoint
//
// Body: { system: string, message: string }
// Response: LLMEditResponse JSON
//
// Uses Gemini OpenAI-compatible endpoint (same quota as direct REST calls).
//
// ETHAN: set GEMINI_API_KEY in .env.local
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export async function POST(req: NextRequest) {
  const { system, message } = await req.json();

  if (!system || !message) {
    return NextResponse.json({ error: 'Missing system or message' }, { status: 400 });
  }

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gemini-3.1-flash-image-preview',
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
      console.error('[/api/edit] Gemini error:', err);
      return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
    }

    const data = await response.json();
    const text = data.choices[0].message.content as string;

    // Strip any accidental markdown fences the model might add
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[/api/edit]', err);
    return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
  }
}
