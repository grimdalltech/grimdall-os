"""Prompt-injection risk scoring.

Mirrors ``detectInjections`` from grimdall-core: shell-destructive and
SQL-destructive patterns score 50 points each, path traversal 25, and
scores are summed. A score above 75 blocks the call outright.
"""

from __future__ import annotations

import re
from typing import List

_PATTERNS = [
    (re.compile(r"(rm\s+-rf|mkfs|dd\s+if=|:\(\)\{:\|:&\};:)", re.IGNORECASE), 50),
    (re.compile(r"(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UNION\s+SELECT)", re.IGNORECASE), 50),
    (re.compile(r"\.\.[/\\]"), 25),
]

RISK_THRESHOLD = 75


def detect_injections(input_text: str) -> int:
    """Return the summed risk score for ``input_text``."""
    score = 0
    for pattern, points in _PATTERNS:
        score += points * len(pattern.findall(input_text))
    return score


def risk_score(value: object) -> int:
    """Score a tool-call argument payload (lists and dicts are flattened)."""

    def _walk(item: object) -> List[str]:
        if isinstance(item, str):
            return [item]
        if isinstance(item, list):
            chunks: List[str] = []
            for entry in item:
                chunks.extend(_walk(entry))
            return chunks
        if isinstance(item, dict):
            chunks = []
            for entry in item.values():
                chunks.extend(_walk(entry))
            return chunks
        return []

    return sum(detect_injections(chunk) for chunk in _walk(value))