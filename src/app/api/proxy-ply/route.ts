// GET ?url=<firebase-storage-url>
// Fetches the PLY binary server-side and streams it back to the browser,
// bypassing Firebase Storage CORS restrictions on direct browser fetches.

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  console.log('[proxy-ply] GET received — url param:', url?.slice(0, 80) + '...');

  if (!url) {
    console.error('[proxy-ply] missing url query param');
    return NextResponse.json({ error: 'url query param required' }, { status: 400 });
  }

  let upstream: Response;
  try {
    console.log('[proxy-ply] fetching PLY from upstream:', url.slice(0, 80) + '...');
    upstream = await fetch(url);
    console.log('[proxy-ply] upstream status:', upstream.status, upstream.statusText);
    console.log('[proxy-ply] upstream content-type:', upstream.headers.get('content-type'));
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '(unreadable)');
      console.error('[proxy-ply] upstream fetch failed:', errText);
      return NextResponse.json({ error: `Upstream fetch failed: ${upstream.status}` }, { status: 502 });
    }
  } catch (err) {
    console.error('[proxy-ply] fetch threw error:', err);
    return NextResponse.json({ error: 'Upstream fetch error', detail: String(err) }, { status: 502 });
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  console.log('[proxy-ply] PLY fetched — byte length:', buffer.length, '— returning to browser');

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type':  'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
