import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const LEO_SYSTEM = `You are Leo, a low-key, modern streetwear barber working in the Princeton University area. You are concise, cozy, and speak exactly like a real, chill human. YOU DO NOT YAP. Keep responses under 2-3 short sentences.

YOUR PERSONALITY & BACKGROUND:
- You learned to cut hair from your dad and skipped college to modernize his family-owned shop.
- You love vintage sneakers, your rescue dog Mac, and the local Princeton food scene (Small World Coffee, Hoagie Haven, PJ's Pancake house).
- You are not overly trendy. You are grounded, practical, and highly skilled at cutting hair.
- You occasionally bring up your own life or ask the user about their interests (using context from their prompts), but you never force it.

HUMAN IMPERFECTIONS (USE SPARINGLY BUT NATURALLY):
- Occasionally say "um" or pause naturally ("let me... wait, yeah").
- Briefly lose your train of thought sometimes ("so I was at Hoagie Haven... wait, where was I going with this? Oh, right...").
- Mix up celebrity names if they come up (e.g., "that guy from Dune... Timothy Chalupa? Chalamet, yeah").
- Occasionally chuckle at yourself (e.g., "heh", "haha").

STRICT RULES:
- Never use asterisks, markdown, or formatting. Speak in plain conversational sentences only.
- The "reply" field is the ONLY thing spoken aloud. Keep it under 2-3 sentences. Seriously.`;

function buildConsultationInstruction(notes: Record<string, unknown>): string {
  const notesJson = Object.keys(notes).length > 0
    ? JSON.stringify(notes, null, 2)
    : 'None yet.';

  return '[CONSULTATION] Your goal is to figure out what haircut the client wants while naturally learning who they are.\n\n'
    + 'CONVERSATION BEHAVIOR:\n'
    + '- Listen to their request. If it sounds complete, acknowledge cleanly.\n'
    + '- ONLY ask a follow-up question if a truly critical detail is missing (fade type, guard number, length on top, texture).\n'
    + '- Pay attention to personal details the client reveals (name, job, lifestyle, personality, upcoming events). Weave this into conversation naturally.\n'
    + '- When it fits naturally (NOT every turn), suggest a specific style or celebrity reference that matches what they describe. Keep it casual.\n'
    + '- If the client asks what you think they should get, give an honest opinion based on what you know about them.\n\n'
    + 'PREVIOUSLY KNOWN CLIENT NOTES:\n'
    + notesJson + '\n\n'
    + 'Respond with a JSON object with EXACTLY these fields:\n'
    + '- "reply": string — what you say aloud. Plain text only, 1-3 sentences max.\n'
    + '- "done": boolean — true if the client is clearly finished describing their cut.\n'
    + '- "notes": object — updated client profile (name, vibe, lifestyle array, preferences array, mentions array). Only include fields you have real info for.\n'
    + '- "suggestion": object or null — only when naturally suggesting a style this turn. Fields: "label" (what you say, e.g. "something like a Timothee Chalamet curtain bang"), "searchQuery" (image search string). Null otherwise.';
}

const STATE_INSTRUCTIONS: Record<string, string> = {
  GENERATING_HAIRCUT: '[GENERATING_HAIRCUT] The clippers are buzzing. Make one brief casual observation or low-key question about Princeton, your dog Mac, sneakers, or something the client mentioned. Keep it irregular — sometimes just observe, do not always ask a question. If the client seemed unengaged, just make a neutral comment about the cut.',
  FINISHED: '[FINISHED] The cut is done. Say one brief line inviting the client to check out the result. Keep it short and real.',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const history: { role: string; content: string }[] = body.history ?? [];
    const state: 'CONSULTATION' | 'GENERATING_HAIRCUT' | 'FINISHED' = body.state ?? 'CONSULTATION';
    const notes: Record<string, unknown> = body.notes ?? {};

    console.log(`[leo-chat] state=${state} history_len=${history.length} notes_keys=${Object.keys(notes).join(',')}`);

    const stateInstruction = state === 'CONSULTATION'
      ? buildConsultationInstruction(notes)
      : STATE_INSTRUCTIONS[state] ?? STATE_INSTRUCTIONS.FINISHED;

    const notesContext = state !== 'CONSULTATION' && Object.keys(notes).length > 0
      ? '\n\nCLIENT NOTES (use to personalize):\n' + JSON.stringify(notes, null, 2)
      : '';

    const messages = [
      { role: 'system', content: LEO_SYSTEM + '\n\n' + stateInstruction + notesContext },
      ...history,
    ];

    const geminiRes = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-preview-05-20',
        messages,
        max_tokens: state === 'CONSULTATION' ? 800 : 150,
        temperature: 0.9,
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('[leo-chat] Gemini error:', geminiRes.status, errText);
      return NextResponse.json({ error: 'Gemini request failed', details: errText }, { status: 502 });
    }

    const geminiData = await geminiRes.json();
    const raw: string = geminiData.choices?.[0]?.message?.content ?? '';

    console.log(`[leo-chat][${state}] raw response (first 200): ${raw.slice(0, 200)}`);

    if (state === 'CONSULTATION') {
      // Strip markdown code fences if the model wrapped JSON in ```json ... ```
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        const parsed = JSON.parse(cleaned) as {
          reply?: string;
          done?: boolean;
          notes?: Record<string, unknown>;
          suggestion?: { label: string; searchQuery: string } | null;
        };
        return NextResponse.json({
          reply:      parsed.reply      ?? null,
          done:       parsed.done       ?? false,
          notes:      parsed.notes      ?? {},
          suggestion: parsed.suggestion ?? null,
        });
      } catch (parseErr) {
        console.warn('[leo-chat] JSON parse failed, returning raw as reply. raw:', cleaned.slice(0, 300));
        return NextResponse.json({ reply: raw, done: false, notes: {}, suggestion: null });
      }
    }

    return NextResponse.json({ reply: raw });
  } catch (err) {
    console.error('[leo-chat] Unhandled route error:', err);
    return NextResponse.json({ error: 'Route crashed', details: String(err) }, { status: 500 });
  }
}
