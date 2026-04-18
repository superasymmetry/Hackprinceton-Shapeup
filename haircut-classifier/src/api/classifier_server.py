"""FastAPI service for the haircut classifier.

Endpoints:
  POST /classify/image  (multipart: image) -> contract
  POST /classify/text   (JSON:     prompt) -> contract
  GET  /taxonomy                           -> taxonomy.json

Contract:
  {
    "top1_style_id": "style_014_mohawk" | "unknown_or_ambiguous",
    "top1_confidence": 0.82,
    "topk": [["style_id", prob], ...]   // length = ServingConfig.top_k
  }

Run:
  uvicorn src.api.classifier_server:app --host 0.0.0.0 --port 5003

Pattern mirrors server/facelift_server.py (threaded model load, JSON errors)
so the Next.js frontend can reuse its existing server-polling hooks.
"""
from __future__ import annotations

import io
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel

from src.config import TAXONOMY_JSON
from src.inference.predict import get_classifier


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[classifier_server] warming backbone + building prototypes…")
    get_classifier()
    print("[classifier_server] ready.")
    yield


app = FastAPI(title="haircut-classifier", version="0.1.0", lifespan=lifespan)


class TextRequest(BaseModel):
    prompt: str


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/taxonomy")
def taxonomy() -> JSONResponse:
    with open(TAXONOMY_JSON) as f:
        return JSONResponse(content=json.load(f))


@app.post("/classify/image")
async def classify_image(image: UploadFile = File(...)) -> dict:
    if image.content_type is None or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="expected an image upload")
    raw = await image.read()
    try:
        pil = Image.open(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"bad image: {e}") from e
    return get_classifier().classify_image(pil)


@app.post("/classify/text")
def classify_text(req: TextRequest) -> dict:
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt must be non-empty")
    return get_classifier().classify_text(prompt)
