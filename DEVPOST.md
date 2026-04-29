# ShapeUp

## Inspiration

ShapeUp started with our founders getting a bad haircut. We all know the type of haircuts that requires one to wear a hat for 2 weeks. So, we decided to build something to allow users to fully customize their hairstyle in a hyper-realistic 3D environment before getting a bad haircut.

## What it does

ShapeUp lets a user preview and edit a hairstyle on a personalized 3D model before getting the haircut itself.

The flow is:

1. **Scan:** An iOS capture app uses ARKit TrueDepth to collect a high-fidelity face mesh of the user's head.
2. **Reconstruct:** A single photo of the user is processed by FaceLift to produce a photorealistic Gaussian splat head model and by HairStep to extract a strand-level PLY hair mesh.
3. **Classify:** A lightweight OpenCLIP-based classifier estimates the user's starting hairstyle across a curated taxonomy of 50+ styles.
4. **Render:** A web-based `react-three-fiber` scene mounts the personalized Gaussian splat head and editable hair strand mesh.
5. **Edit:** The user describes the haircut they want in plain English (or by voice), and the LLM converts that into structured hair-parameter edits applied directly to the PLY geometry.
6. **Export:** The final look is summarized into a barber-readable spec the user can screenshot and bring to the shop.

Instead of relying on a generic style picker, ShapeUp gives the user a haircut preview on their own head geometry and lets them refine it interactively.

## How we built it

Our stack combined mobile capture, 3D reconstruction, browser rendering, and LLM-based control:

- **Frontend:** Next.js 16, TypeScript, Tailwind
- **3D rendering:** `three`, `react-three-fiber`
- **Language layer:** Gemini
- **Voice layer:** ElevenLabs
- **ML / reconstruction pipeline:** Python, PyTorch, OpenCLIP
- **Mobile capture:** Swift, ARKit

### Pipeline

iOS TrueDepth  →  ARKit face mesh  
↓  
Single photo  →  FaceLift  →  Gaussian splat head model  
↓  
Single photo  →  HairStep  →  strand PLY hair mesh  
↓  
Hair classifier  →  initial HairParams  
↓  
Three.js scene (Gaussian splat head + strand hair mesh)  
↓  
LLM edit loop: prompt → structured JSON → PLY geometry delta

### FaceLift + HairStep reconstruction

FaceLift takes a single portrait photo and produces a Gaussian splat representation of the user's head by fitting a set of 3D Gaussians whose projected appearance matches the input image. HairStep runs in parallel and produces a PLY file where vertices are sampled strand positions and edges encode root-to-tip connectivity.

| Component | Meaning |
| --- | --- |
| Gaussian splat | Differentiably rendered ellipsoids fit to match the photo appearance |
| Strand PLY | Vertex positions and edge connectivity encoding root-to-tip hair chains |
| Region classification | Strands binned to top, side, or back by their normalized growth vector |
| Delta application | Length edit applied along strand direction, tapering from root to tip |

| Symbol | Description |
| --- | --- |
| \( \mu_i \) | Center position of Gaussian \( i \) |
| \( \Sigma_i \) | Covariance matrix of Gaussian \( i \), decomposed as \( R_i S_i S_i^T R_i^T \) |
| \( \alpha_i \) | Learned opacity of Gaussian \( i \) |
| \( c_i \) | View-dependent color encoded as spherical harmonic coefficients |
| \( \hat{d} \) | Normalized growth direction of a hair strand |
| \( \delta \) | Per-region length delta applied during an edit |
| \( t \) | Taper parameter, 0 at the strand root and 1 at the tip |

In practice, this means FaceLift optimizes a set of Gaussians so that their differentiably rendered projection matches the input portrait, giving a photorealistic head model that loads directly in the browser with no UV unwrapping or texture baking. On the hair side, editing a region amounts to walking each strand root-to-tip and applying \( \text{position}_i \mathrel{+}= \hat{d} \cdot \delta \cdot t \), so longer strands taper naturally rather than translating rigidly.

### LLM edit contract

A key design decision was that the LLM never directly emits geometry. Instead, it only outputs a constrained typed payload:

```ts
type LLMEditResponse = {
  preset?: HairPreset;
  top_length?: number;   // 0..2
  side_length?: number;  // 0..2
  back_length?: number;  // 0..2
  messiness?: number;    // 0..1
  taper?: number;        // 0..1
};
```

That made the system much more robust. The model cannot hallucinate a mesh or invent an unsupported transformation. It can only choose a preset and nudge a small set of interpretable parameters, which are then applied as geometric deltas to the actual PLY strand mesh.

### Why this architecture worked

The biggest architectural insight was separating:
- **identity reconstruction** from the photo (FaceLift + HairStep),
- **style understanding** from the classifier,
- **interactive editing** from the LLM,
- and **visual updates** from the rendering layer.

That gave us a system that feels conversational to the user, while still remaining controllable underneath.

## Challenges we ran into

### 1. Getting FaceLift and HairStep to run reliably

Both services run locally as Python processes exposed via ngrok tunnels. Keeping those tunnels alive, handling cold-start latency, and streaming large binary responses (splat files can be several MB) required careful async job polling and timeout management on both the server and client.

### 2. Parsing and editing PLY strand geometry

HairStep outputs a raw PLY with vertices and edges but no explicit strand labels. We had to reconstruct strand topology by tracing edge-connectivity chains from root to tip, then classify each strand's head region by its growth vector before we could apply directional length deltas correctly.

### 3. Coordinate system mismatches

ARKit, FaceLift, HairStep, and Three.js all use different conventions for axes, orientation, and units. A single sign flip or unit mismatch could make the rendered result look completely broken. We eventually centralized all transforms into one conversion layer.

### 4. Gaussian splat rendering in the browser

Loading and rendering splats in real time required implementing a custom splat binary parser (32 bytes per splat encoding position, scale, rotation, and RGBA) and integrating it with the Three.js scene alongside the separately rendered hair strands.

### 5. Making "hair parameters" actually mean something

For controls like `top_length`, `side_length`, and `back_length` to behave intuitively, we had to drive per-strand delta magnitudes based on region classification and taper the delta linearly from root to tip so edits look natural rather than mechanical.

### 6. Constraining user intent into a small edit space

Users naturally describe hairstyles with references like "give me a David Beckham 2003" or "cleaner but still textured." Mapping those onto a five-parameter schema required careful prompting, examples, and sensible preset fallbacks.

### 7. Scope control

We had more ideas than time. We explored things like VR try-on and richer export flows, but had to cut them to ship a working end-to-end system during the hackathon.

## Accomplishments that we're proud of

We are proud that we built a working pipeline that goes from a real photo to an editable personalized haircut preview.

More specifically, we are proud that we:
- turned a single portrait photo into a photorealistic Gaussian splat head model using FaceLift,
- extracted and rendered editable strand-level hair geometry using HairStep,
- made LLM-based editing reliable by constraining output to structured parameters applied as PLY geometry deltas,
- reduced edit latency dramatically by operating on compact parameter deltas instead of full mesh regeneration,
- integrated voice-driven editing via ElevenLabs so users can describe their haircut conversationally,
- and created something that solves a very real, very relatable problem.

The product feels much more like a design tool than a gimmick. That was important to us.

## What we learned

### Structured output is the unlock for LLM-controlled 3D

Free-form text is too ambiguous for geometry. Once we reduced the LLM's job to producing a small validated parameter object, the whole system became much more predictable and usable.

### Latency matters more than visual perfection in interactive tools

Early versions re-rendered too much and felt sluggish. Once we switched to preloaded Gaussian splat assets plus PLY geometry deltas, the experience became much more fluid. The interaction quality improved more from lower latency than from adding fidelity.

### Gaussian splats are powerful abstractions for identity preservation

Representing a person's head as a set of Gaussians rather than a mesh preserves photorealistic appearance without texture baking or UV unwrapping. That made the rendering pipeline much simpler to ship under hackathon time pressure.

### The hard part is not just the model

A lot of the work was in glue code, transforms, binary format parsing, validation, rendering constraints, and product decisions. The "AI" only worked because the rest of the system was carefully bounded.

## What's next for ShapeUp

We see several natural next steps:

- Replace the preset-driven hair system with a learned deformation model for smoother continuous editing between styles.
- Improve the export flow into a true barber-ready spec with measurements and view snapshots.
- Expand beyond TrueDepth-only capture so more users can access the product on non-Pro phones and Android devices.
- Improve hairstyle classification with a stronger curated taxonomy and a dedicated constrained style classifier.
- Add better style transfer from reference images while preserving the user's head geometry.

Longer term, we think ShapeUp could become the interface layer between personal 3D capture and real-world appearance decisions, starting with haircuts.

## Built With

- Next.js
- TypeScript
- Tailwind CSS
- Three.js
- react-three-fiber
- Python
- PyTorch
- OpenCLIP
- Swift
- ARKit
- FaceLift
- HairStep
- Google Gemini
- ElevenLabs
- Firebase

## Final Note

ShapeUp is about making haircut decisions less ambiguous, less stressful, and much more visual. Instead of hoping your barber interprets your words correctly, you can show them exactly what you mean on a model of your own head.
