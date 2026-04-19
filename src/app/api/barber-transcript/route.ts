import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export async function POST(req: NextRequest) {
  const { transcript } = await req.json();

  if (!transcript || typeof transcript !== 'string') {
    return NextResponse.json({ error: 'Missing transcript' }, { status: 400 });
  }

  console.log('[barber-transcript] Received transcript:', transcript);

  const system = `You are a barber assistant. The client described their desired haircut in a voice conversation. Summarize what they want as bullet points (max 10, each starting with "•"). Be specific about cut style, length, texture, fade type, and techniques mentioned. Only include what the client actually said — do not invent details.`;

  const message = `Client said: "${transcript}"\n\nWrite the barber summary bullet points now.`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-preview-05-20',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
        max_tokens: 512,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[barber-transcript] Gemini error:', err);
      return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
    }

    const data = await response.json();
    const bullets = data.choices[0].message.content as string;

    console.log('[barber-transcript] Gemini bullets response:', bullets);

    return NextResponse.json({ bullets });
  } catch (err) {
    console.error('[barber-transcript] Request failed:', err);
    return NextResponse.json({ error: 'Transcript summarization failed' }, { status: 500 });
  }
}
