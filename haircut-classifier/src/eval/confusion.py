"""Confusion-matrix utilities and hard-negative miner for M6."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ConfusedPair:
    a_idx: int
    b_idx: int
    count: int
    rate: float  # count / (support_a + support_b)


def top_confused_pairs(
    confusion: list[list[int]],
    k: int = 20,
    min_count: int = 5,
) -> list[ConfusedPair]:
    """Return the top-k off-diagonal pairs, symmetrized (A->B and B->A merged)."""
    n = len(confusion)
    supports = [sum(confusion[i]) for i in range(n)]
    seen = set()
    pairs: list[ConfusedPair] = []
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            key = tuple(sorted((i, j)))
            if key in seen:
                continue
            seen.add(key)
            count = confusion[i][j] + confusion[j][i]
            if count < min_count:
                continue
            support = max(1, supports[i] + supports[j])
            pairs.append(ConfusedPair(
                a_idx=key[0], b_idx=key[1], count=count,
                rate=count / support,
            ))
    pairs.sort(key=lambda p: p.rate, reverse=True)
    return pairs[:k]
