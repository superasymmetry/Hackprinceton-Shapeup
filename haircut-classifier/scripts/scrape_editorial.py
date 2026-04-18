"""Bulk-scrape editorial portrait photos from Bing Images for each style_id.

Why: FaceSketches-HairStyle40 gives us only ~30 imgs/class on 40 of the 50
classes, which is below the MIN_TRAIN_PER_CLASS gate. This script pulls ~80
portrait-biased images per style_id using the class name + "hairstyle portrait"
as the query, writes them under data/raw/scraped/<style_id>/, and post-filters
out non-portrait aspect ratios.

icrawler has no API-key requirement; Bing doesn't rate-limit us meaningfully
for this volume. Provenance is preserved via folder = style_id, so the ingest
step treats this identically to any other source.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from icrawler.builtin import BingImageCrawler
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.config import TAXONOMY_JSON  # noqa: E402

OUT_ROOT = ROOT / "data" / "raw" / "scraped"


QUERY_OVERRIDES: dict[str, str] = {
    "style_001_buzz_cut": "buzz cut hairstyle portrait",
    "style_002_crew_cut": "crew cut hairstyle portrait",
    "style_003_caesar_cut": "caesar cut hairstyle portrait",
    "style_004_french_crop": "french crop haircut portrait",
    "style_005_textured_crop": "textured crop haircut portrait",
    "style_006_edgar_cut": "edgar haircut portrait",
    "style_007_ivy_league": "ivy league haircut portrait",
    "style_008_side_part": "side part hairstyle portrait",
    "style_009_comb_over": "comb over haircut portrait",
    "style_010_slick_back": "slick back hairstyle portrait",
    "style_011_pompadour": "pompadour hairstyle portrait",
    "style_012_quiff": "quiff hairstyle portrait",
    "style_013_faux_hawk": "faux hawk hairstyle portrait",
    "style_014_mohawk": "mohawk hairstyle portrait",
    "style_015_undercut": "disconnected undercut hairstyle portrait",
    "style_016_low_taper": "low taper haircut portrait",
    "style_017_mid_taper": "mid taper haircut portrait",
    "style_018_high_taper": "high taper haircut portrait",
    "style_019_low_fade": "low fade haircut portrait",
    "style_020_mid_fade": "mid fade haircut portrait",
    "style_021_high_fade": "high fade haircut portrait",
    "style_022_skin_fade": "skin fade haircut portrait",
    "style_023_burst_fade": "burst fade haircut portrait",
    "style_024_drop_fade": "drop fade haircut portrait",
    "style_025_temple_fade": "temple fade haircut portrait",
    "style_026_bald": "bald man portrait",
    "style_027_curtains": "curtain hairstyle portrait",
    "style_028_flow": "flow hairstyle men portrait",
    "style_029_long_layered": "long layered hair portrait",
    "style_030_shag": "shag haircut portrait",
    "style_031_wolf_cut": "wolf cut hairstyle portrait",
    "style_032_mullet": "mullet hairstyle portrait",
    "style_033_bob": "bob hairstyle portrait",
    "style_034_lob": "long bob lob hairstyle portrait",
    "style_035_asymmetric_bob": "asymmetric bob hairstyle portrait",
    "style_036_pixie": "pixie cut portrait",
    "style_037_bixie": "bixie haircut portrait",
    "style_038_blunt_cut": "blunt cut hairstyle portrait",
    "style_039_shoulder_length": "shoulder length layered hair portrait",
    "style_040_afro": "afro hairstyle portrait",
    "style_041_afro_taper": "afro taper haircut portrait",
    "style_042_twist_out": "twist out hairstyle portrait",
    "style_043_bantu_knots": "bantu knots hairstyle portrait",
    "style_044_locs": "dreadlocks locs hairstyle portrait",
    "style_045_box_braids": "box braids portrait",
    "style_046_knotless_braids": "knotless braids portrait",
    "style_047_cornrows": "cornrows hairstyle portrait",
    "style_048_two_strand_twists": "two strand twists hairstyle portrait",
    "style_049_ponytail": "ponytail hairstyle portrait",
    "style_050_top_knot": "top knot man bun hairstyle portrait",
}


def _filter_portraits(folder: Path, min_side: int = 200) -> int:
    """Remove tiny / landscape / broken images. Returns count kept."""
    kept = 0
    for p in list(folder.iterdir()):
        if not p.is_file():
            continue
        try:
            with Image.open(p) as im:
                w, h = im.size
                if min(w, h) < min_side:
                    p.unlink()
                    continue
                # prefer portrait / near-square (w/h <= 1.25)
                if w / max(h, 1) > 1.25:
                    p.unlink()
                    continue
                im.verify()
        except Exception:
            p.unlink(missing_ok=True)
            continue
        kept += 1
    return kept


def scrape_style(style_id: str, query: str, target: int, threads: int) -> int:
    out = OUT_ROOT / style_id
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    crawler = BingImageCrawler(
        feeder_threads=1,
        parser_threads=1,
        downloader_threads=threads,
        storage={"root_dir": str(out)},
        log_level=30,  # WARNING
    )
    # ask for 2× target to survive portrait-filter attrition
    crawler.crawl(keyword=query, max_num=target * 2, min_size=(200, 200), overwrite=True)
    return _filter_portraits(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=80, help="target images per class after filtering")
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--only", nargs="*", default=None, help="restrict to these style_ids")
    args = ap.parse_args()

    taxonomy = json.loads(Path(TAXONOMY_JSON).read_text())
    style_ids = [s["id"] for s in taxonomy["styles"]]
    if args.only:
        style_ids = [s for s in style_ids if s in set(args.only)]

    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    for i, sid in enumerate(style_ids, 1):
        q = QUERY_OVERRIDES.get(sid, f"{sid.split('_', 2)[-1].replace('_', ' ')} hairstyle portrait")
        print(f"[{i}/{len(style_ids)}] {sid} :: '{q}'", flush=True)
        try:
            kept = scrape_style(sid, q, target=args.per_class, threads=args.threads)
            print(f"  kept {kept} after portrait filter", flush=True)
        except Exception as e:
            print(f"  FAILED: {e}", flush=True)


if __name__ == "__main__":
    main()
