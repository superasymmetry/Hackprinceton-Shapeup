"""Write a Markdown report for a single run."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from src.eval.metrics import Metrics


def write_report(
    out_path: Path,
    run_name: str,
    metrics: Metrics,
    style_ids: list[str],
    top_confused: list[tuple[str, str, int]] | None = None,
    extras: dict[str, str] | None = None,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    lines.append(f"# {run_name}")
    lines.append(f"_Generated: {datetime.utcnow().isoformat()}Z_")
    lines.append("")
    lines.append("## Headline metrics")
    lines.append(f"- top-1 accuracy: **{metrics.top1:.3f}**")
    lines.append(f"- top-3 accuracy: **{metrics.top3:.3f}**")
    lines.append(f"- macro F1:       **{metrics.macro_f1:.3f}**")
    lines.append("")

    if extras:
        lines.append("## Run info")
        for k, v in extras.items():
            lines.append(f"- {k}: {v}")
        lines.append("")

    lines.append("## Per-class F1 (sorted ascending — worst classes first)")
    pairs = sorted(metrics.per_class_f1.items(), key=lambda kv: kv[1])
    lines.append("| rank | style_id | F1 |")
    lines.append("|---|---|---|")
    for rank, (idx, f1) in enumerate(pairs, 1):
        lines.append(f"| {rank} | `{style_ids[idx]}` | {f1:.3f} |")
    lines.append("")

    if top_confused:
        lines.append("## Top confused pairs")
        lines.append("| a | b | count |")
        lines.append("|---|---|---|")
        for a, b, c in top_confused:
            lines.append(f"| `{a}` | `{b}` | {c} |")
        lines.append("")

    out_path.write_text("\n".join(lines))
