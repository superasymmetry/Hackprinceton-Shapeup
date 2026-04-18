"""M8 gate: FastAPI service obeys the inference contract.

Uses FastAPI's in-process TestClient — no uvicorn needed. Expensive: the first
test triggers CLIP model download + prototype construction (~30 s cold). On CI,
gate this test with a marker if needed; for local dev, running once primes the
HF cache so subsequent runs are fast.
"""
from __future__ import annotations

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.api.classifier_server import app
from src.config import TAXONOMY_JSON


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # triggers @app.on_event("startup")
        yield c


@pytest.fixture(scope="module")
def valid_style_ids():
    with open(TAXONOMY_JSON) as f:
        return {s["id"] for s in json.load(f)["styles"]}


def _assert_contract(body, valid_ids):
    assert set(body.keys()) == {"top1_style_id", "top1_confidence", "topk"}
    assert isinstance(body["top1_confidence"], float)
    assert 0.0 <= body["top1_confidence"] <= 1.0
    assert isinstance(body["topk"], list) and len(body["topk"]) == 3
    for entry in body["topk"]:
        assert len(entry) == 2
        sid, prob = entry
        assert sid in valid_ids, f"unknown style_id {sid}"
        assert 0.0 <= prob <= 1.0
    assert body["top1_style_id"] in valid_ids | {"unknown_or_ambiguous"}


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_taxonomy_endpoint_returns_frozen_taxonomy(client, valid_style_ids):
    r = client.get("/taxonomy")
    assert r.status_code == 200
    served_ids = {s["id"] for s in r.json()["styles"]}
    assert served_ids == valid_style_ids


def test_classify_text_returns_contract(client, valid_style_ids):
    r = client.post("/classify/text", json={"prompt": "high skin fade"})
    assert r.status_code == 200
    _assert_contract(r.json(), valid_style_ids)


def test_classify_text_rejects_empty_prompt(client):
    r = client.post("/classify/text", json={"prompt": "   "})
    assert r.status_code == 400


def test_classify_image_returns_contract(client, valid_style_ids):
    # Construct a trivial dummy image; we only check the contract shape,
    # not the accuracy of the prediction.
    img = Image.new("RGB", (224, 224), color=(127, 127, 127))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    r = client.post(
        "/classify/image",
        files={"image": ("test.png", buf, "image/png")},
    )
    assert r.status_code == 200
    _assert_contract(r.json(), valid_style_ids)


def test_classify_image_rejects_non_image_upload(client):
    r = client.post(
        "/classify/image",
        files={"image": ("bad.txt", io.BytesIO(b"not an image"), "text/plain")},
    )
    assert r.status_code == 400
