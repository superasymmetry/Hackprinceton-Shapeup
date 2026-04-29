# ShapeUp

**Prompt-based 3D haircut simulator.** Scan your face, describe a style, and preview it on a photorealistic 3D model of your own head — before you sit down in the barber's chair.

---

## How It Works

### Pipeline Overview

```
iPhone camera / ARKit TrueDepth
        ↓
   MediaPipe FaceMesh (468 landmarks)
        ↓
   FaceLift  ──────────────────────────────────────────┐
   (Gaussian splat head reconstruction)                │
                                                       ↓
   SMERK (baldify + face mesh "mold")        Three.js scene
   (hair removal + spatial alignment)                  │
        ↓                                              │
   USC-HairSalon (343 hair models)  ─────────────────→ ┘
   (PCA nearest-neighbor blend)
        ↓
   LLM edit loop  (Gemini / Claude)
        ↓
   Barber-ready text summary
```

---

### 1. Head Reconstruction — FaceLift

A single photo is fed into **FaceLift**, which optimizes a set of 3D Gaussians to match the photo's appearance. The output (.ply) is converted into a `.splat` file — a binary-packed Gaussian splat representation of the user's head, rendered photorealistically in-browser via Three.js.

To avoid redundant computation, the user's head is **baldified first via Gemini Nano Banana and cached**. All subsequent hair previews reuse the same bald head reconstruction, reducing N head generations (one per hairstyle) to a single generation.

---

### 2. Hair Generation — USC-HairSalon + PCA

Rather than generating hair strands from scratch, 343 strand-level hair models from the **USC-HairSalon** dataset are pre-reduced along **3 PCA axes** (width, length, . For any user prompt, the system finds the nearest neighbor in PCA space and blends between adjacent models — producing strand-level `.ply` geometry with essentially no GPU cost at inference time.

Each hair model encodes root-to-tip connectivity as edge-linked strands. Strands are classified into regions (top / sides / back) by their growth vector, enabling independent scaling per region.

---

### 3. Spatial Alignment — SMERK

FaceLift (Gaussian splats) and the USC-HairSalon PLY files use different axis conventions and scale spaces. **SMERK** bridges this gap by creating an invisible face mesh "mold" via facial feature coordinates. The mold acts as a shared coordinate frame: hair strands are scaled, rotated, and positioned to fit the mold, guaranteeing alignment with the Gaussian splat head without manual calibration.

Hair inpainting removes the user's existing hair from the reference image so FaceLift reconstructs a clean bald head suitable for all downstream hairstyles.

---

### 4. Interactive Edit Loop

```
User prompt  →  LLM (Gemini / Claude)
                  context: head profile + current hair params
                  output:  { preset?, topLength, sideLength,
                              backLength, messiness, taper }
             →  Mesh param update (no re-render)
             →  Undo / redo stack
```

The edit schema is a closed 5-parameter contract plus an optional preset name. This lets the LLM drive mesh changes with structured JSON output, keeping latency low and output deterministic.

Voice input (ElevenLabs) is supported as an alternative to text.

---

### 5. Output

Final hair parameters are passed back to the LLM, which generates a plain-English barber summary the user can copy and hand to their stylist.

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| 3D rendering | Three.js, react-three-fiber, react-three-drei |
| Face capture | ARKit TrueDepth (iOS), MediaPipe FaceMesh |
| Head reconstruction | FaceLift (Gaussian splatting) |
| Hair alignment | SMERK (face mesh mold, axis alignment) |
| Hair geometry | USC-HairSalon (343 models), PCA blending |
| Hair classification | OpenCLIP fine-tuned on 50+ style taxonomy |
| LLM edit loop | Gemini (primary), Claude (fallback) |
| Voice input | ElevenLabs conversational agent |
| Python services | Flask (FaceLift wrapper, SMERK), FastAPI (classifier) |
| ML runtime | PyTorch |
| Storage / auth | Firebase |

---

## Repo Structure

```
/src
  /app            Next.js pages and API routes
  /components     React components (HairScene, EditPanel, ScanCamera, …)
  /hooks          useFaceLift, useSmirk, useHairStep, useLLM, …
  /lib            PLY parsing, geometric transforms, LLM prompt templates
  /types          Core data contracts (HairParams, UserHeadProfile, …)
  /data           Mock profiles and preset library

/server
  facelift_server.py   Flask wrapper around FaceLift
  smirk_server.py      Flask wrapper around SMERK (baldify)
  edit_hair_ply.py     Strand-level PLY editing (length, taper, region)

/haircut-classifier
  OpenCLIP-based classifier, 50+ hairstyle taxonomy, FastAPI endpoint

/FLAME_PyTorch
  Parametric head fitting (landmark + point-to-plane loss)

/ios-face-capture
  ARKit TrueDepth capture app (Swift)

/scripts
  PLY conversion, visualization, hair mesh utilities

/public
  output.ply / output.splat   FaceLift output (cached)
  /hair                       Pre-built strand PLY files
  /baldified                  Cached baldified reference images
```

---

## Setup

**Frontend**

```bash
npm install
cp .env.local.example .env.local   # add GEMINI_API_KEY, service URLs
npm run dev
```

**Python services** (each runs in its own terminal, exposed via ngrok)

```bash
# FaceLift server
cd server && python facelift_server.py

# SMERK server
cd server && python smirk_server.py

# Hair classifier
cd haircut-classifier && uvicorn src.api.classifier_server:app --port 5003
```

Update `FACELIFT_URL`, `SMIRK_URL`, and `HAIR_CLASSIFIER_URL` in `.env.local` with the ngrok tunnel URLs.

---

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Gemini API key (primary LLM) |
| `ANTHROPIC_API_KEY` | Claude API key (fallback LLM) |
| `FACELIFT_URL` | ngrok URL for FaceLift Flask server |
| `SMIRK_URL` | ngrok URL for SMERK Flask server |
| `HAIRSTEP_URL` | ngrok URL for HairStep server |
| `HAIR_CLASSIFIER_URL` | ngrok URL for OpenCLIP classifier |
| `ELEVENLABS_API_KEY` | ElevenLabs voice agent |

---

## Team

Built at HackPrinceton 2024.
