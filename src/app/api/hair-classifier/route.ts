import { NextRequest, NextResponse } from 'next/server';

const HAIR_CLASSIFIER_URL = process.env.HAIR_CLASSIFIER_URL ?? '';

interface ProbsResponse {
  style_ids: string[];
  sims: number[];
  temperature: number;
  confident_threshold: number;
  ambiguous_threshold: number;
}

function softmax(values: number[]): number[] {
  const maxValue = Math.max(...values);
  const expValues = values.map((value) => Math.exp(value - maxValue));
  const total = expValues.reduce((sum, value) => sum + value, 0);
  return expValues.map((value) => value / total);
}

async function classifyImageWithScores(imageDataUrl: string): Promise<ProbsResponse> {
  const [meta, base64] = imageDataUrl.split(',', 2);
  const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64$/.exec(meta ?? '');
  if (!mimeMatch || !base64) {
    throw new Error('Invalid imageDataUrl');
  }

  const buffer = Buffer.from(base64, 'base64');
  const blob = new Blob([buffer], { type: mimeMatch[1] });

  const form = new FormData();
  form.append('image', blob, 'scan-image.jpg');

  const upstream = await fetch(`${HAIR_CLASSIFIER_URL}/classify/image/probs`, {
    method: 'POST',
    headers: {
      'ngrok-skip-browser-warning': '1',
      'User-Agent': 'shapeup',
    },
    body: form,
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    throw new Error(`Hair classifier server error: ${text}`);
  }

  return upstream.json();
}

export async function POST(req: NextRequest) {
  if (!HAIR_CLASSIFIER_URL) {
    return NextResponse.json(
      { error: 'HAIR_CLASSIFIER_URL not configured' },
      { status: 503 },
    );
  }

  const body = await req.json();
  const imageDataUrls: unknown[] = Array.isArray(body.imageDataUrls)
    ? body.imageDataUrls
    : typeof body.imageDataUrl === 'string'
      ? [body.imageDataUrl]
      : [];

  if (
    imageDataUrls.length === 0 ||
    !imageDataUrls.every((url): url is string => typeof url === 'string' && url.startsWith('data:image'))
  ) {
    return NextResponse.json({ error: 'Invalid imageDataUrls' }, { status: 400 });
  }

  try {
    const responses = await Promise.all(imageDataUrls.map(classifyImageWithScores));
    const first = responses[0];
    const avgSims = first.sims.map((_, idx) => (
      responses.reduce((sum, current) => sum + current.sims[idx], 0) / responses.length
    ));
    const scaledLogits = avgSims.map(
      (sim) => (sim / Math.max(first.temperature, 1e-6)) * 100,
    );
    const avgProbs = softmax(scaledLogits);

    const scored = first.style_ids.map((styleId, idx) => ({
      styleId,
      confidence: avgProbs[idx],
    })).sort((a, b) => b.confidence - a.confidence);

    const topk = scored.slice(0, 3).map((entry) => [entry.styleId, entry.confidence]);
    const top1 = scored[0];
    const top1StyleId = top1.confidence < first.ambiguous_threshold
      ? 'unknown_or_ambiguous'
      : top1.styleId;

    return NextResponse.json({
      top1_style_id: top1StyleId,
      raw_top1_style_id: top1.styleId,
      top1_confidence: top1.confidence,
      topk,
      frames_used: responses.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
