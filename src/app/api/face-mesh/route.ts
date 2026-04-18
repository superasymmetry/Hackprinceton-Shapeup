// ============================================================
// /api/face-mesh — receives ARFaceGeometry from the iOS capture app
//
// POST  { vertices: number[][], indices: number[][] }
//   vertices : [[x,y,z], ...]  1220 points in ARKit camera space (metres)
//   indices  : [[i0,i1,i2], ...]  triangle faces
//
// GET  → returns the last stored mesh (or 404 if none yet)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

interface ARFaceMesh {
  vertices: number[][];   // (1220, 3)
  indices:  number[][];   // (N, 3)
  capturedAt: string;
}

// In-memory store — good enough for a single-user hackathon demo.
// Replace with a file or DB if you need persistence across restarts.
let stored: ARFaceMesh | null = null;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { vertices, indices } = body;

  if (!Array.isArray(vertices) || !Array.isArray(indices)) {
    return NextResponse.json({ error: 'Missing vertices or indices' }, { status: 400 });
  }

  stored = { vertices, indices, capturedAt: new Date().toISOString() };
  console.log(`[/api/face-mesh] stored ${vertices.length} vertices, ${indices.length} faces`);
  return NextResponse.json({ ok: true, vertexCount: vertices.length });
}

export async function GET() {
  if (!stored) {
    return NextResponse.json(null, { status: 200 });
  }
  return NextResponse.json(stored);
}
