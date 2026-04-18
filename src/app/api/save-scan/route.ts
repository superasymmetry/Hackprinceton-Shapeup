import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';

export async function POST(req: NextRequest) {
  try {
    const { imageDataUrl } = await req.json();
    const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const filename = 'scan.jpg';
    const savePath = join(process.cwd(), 'server', 'imgs', filename);
    await writeFile(savePath, buffer);
    return NextResponse.json({ ok: true, filename });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
