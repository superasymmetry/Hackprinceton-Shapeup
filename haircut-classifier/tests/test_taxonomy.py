"""M1 gate: the frozen taxonomy, prompt library, and hard-negative graph are well-formed."""
from __future__ import annotations

import json
import re

from src.config import (
    HARD_NEGATIVES_JSON,
    PROMPTS_JSON,
    TAXONOMY_JSON,
    TAXONOMY_MAP_JSON,
)

STYLE_ID_RE = re.compile(r"^style_\d{3}_[a-z][a-z0-9_]*$")


def _load(path):
    with open(path) as f:
        return json.load(f)


def test_taxonomy_ids_are_unique_and_well_formed():
    taxonomy = _load(TAXONOMY_JSON)
    ids = [s["id"] for s in taxonomy["styles"]]
    assert len(ids) == len(set(ids)), "duplicate style_ids found"
    assert 40 <= len(ids) <= 60, f"expected 40-60 style_ids, got {len(ids)}"
    for sid in ids:
        assert STYLE_ID_RE.match(sid), f"malformed id: {sid}"


def test_taxonomy_entries_have_required_fields():
    taxonomy = _load(TAXONOMY_JSON)
    for s in taxonomy["styles"]:
        assert "id" in s and "name" in s and "description" in s
        assert len(s["description"]) >= 30, f"description too short for {s['id']}"


def test_prompts_cover_every_style_with_enough_variety():
    taxonomy = _load(TAXONOMY_JSON)
    prompts = _load(PROMPTS_JSON)
    templates = prompts["templates"]
    assert len(templates) >= 10, "need >=10 prompt templates"
    by_style = prompts["by_style"]
    for s in taxonomy["styles"]:
        sid = s["id"]
        assert sid in by_style, f"missing prompts for {sid}"
        synonyms = by_style[sid]["synonyms"]
        assert len(synonyms) >= 3, f"{sid} needs >=3 synonyms"
        # Cartesian product must yield >=10 unique prompts
        assert len(templates) * len(synonyms) >= 10, f"{sid} prompt variety too low"


def test_hard_negatives_are_symmetric_and_sufficient():
    taxonomy = _load(TAXONOMY_JSON)
    hn = _load(HARD_NEGATIVES_JSON)
    pairs = hn["pairs"]
    ids = {s["id"] for s in taxonomy["styles"]}

    for sid in ids:
        assert sid in pairs, f"hard_negatives missing {sid}"
        assert len(pairs[sid]) >= 3, f"{sid} has <3 hard negatives"
        # All listed negatives must exist in the taxonomy
        for neg in pairs[sid]:
            assert neg in ids, f"unknown hard-negative {neg} for {sid}"
            assert neg != sid, f"{sid} lists itself as hard-negative"

    # Symmetry: if A lists B, B must list A
    for a, negs in pairs.items():
        for b in negs:
            assert a in pairs[b], (
                f"asymmetric hard-negative graph: {a} lists {b}, but {b} does not list {a}"
            )


def test_taxonomy_map_targets_exist():
    taxonomy = _load(TAXONOMY_JSON)
    tmap = _load(TAXONOMY_MAP_JSON)
    ids = {s["id"] for s in taxonomy["styles"]}

    non_source_keys = {"version", "notes", "reject_reasons"}
    for source, mapping in tmap.items():
        if source in non_source_keys or not isinstance(mapping, dict):
            continue
        for src_class, target in mapping.items():
            if src_class.startswith("_"):
                continue
            # Allow explicit sentinels; everything else must be a real style_id
            if target in {"__ambiguous__", "__FILL_ME__", "__no_mapping__"}:
                continue
            assert target in ids, (
                f"{source}.{src_class} -> {target} is not a known style_id"
            )
