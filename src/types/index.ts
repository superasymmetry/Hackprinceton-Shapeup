// ============================================================
// Core Data Contract — DO NOT modify without team consensus
// This schema is the single source of truth across all phases.
// ============================================================

export interface HairParams {
  topLength: number;    // 0.0 – 2.0  (scale of Top mesh group)
  sideLength: number;   // 0.0 – 2.0  (scale of Sides mesh group)
  backLength: number;   // 0.0 – 2.0  (scale of Back mesh group)
  messiness: number;    // 0.0 – 1.0  (vertex-jitter noise amplitude)
  taper: number;        // 0.0 – 1.0  (gradient falloff from crown)
}

export interface ARFaceMesh {
  // TrueDepth capture from iOS ARFaceGeometry (1220 vertices, real depth)
  vertices:  number[][];   // (1220, 3) — ARKit camera space, metres
  indices:   number[][];   // (N, 3)   — triangle faces
  capturedAt: string;
}

export interface FaceScanData {
  // Raw MediaPipe landmarks at scan completion (468 points, normalized 0–1)
  landmarks: Array<{ x: number; y: number; z: number }>;
  // Base64 snapshot of the camera frame (used as face texture)
  imageDataUrl: string;
  // Image dimensions the landmarks were captured at
  imageWidth: number;
  imageHeight: number;
  // Optional high-fidelity TrueDepth mesh — preferred over landmarks when present
  arMesh?: ARFaceMesh;
}

export interface UserHeadProfile {
  // ── Scan Phase Output (MediaPipe) ──────────────────────────
  headProportions: {
    width: number;    // Three.js scene units
    height: number;
    crownY: number;   // Y coord of crown in scene space
  };
  anchors: {
    earLeft: [number, number, number];   // [x, y, z]
    earRight: [number, number, number];
  };
  hairMeasurements: {
    crownHeight: number;   // how tall the hair sits above crown
    sideWidth: number;
    backLength: number;
    flatness: number;      // 0 = very flat, 1 = very voluminous
  };

  // ── Optional face mesh data (when full scan is performed) ──
  faceScanData?: FaceScanData;

  // ── State for RENDER + EDIT phases ─────────────────────────
  currentStyle: {
    preset: HairPreset;
    hairType: 'straight' | 'wavy' | 'curly';
    colorRGB: string;   // hex e.g. "#3b1f0a"
    params: HairParams;
  };
}

export type HairPreset =
  | 'buzz'
  | 'pompadour'
  | 'undercut'
  | 'taper_fade'
  | 'afro'
  | 'waves'
  | 'default';

// LLM Edit Loop response — only the mutable slice
export interface LLMEditResponse {
  preset?: HairPreset;
  params: HairParams;
}
