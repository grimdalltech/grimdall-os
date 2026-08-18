"""Default policies, identical to grimdall-core's DEFAULT_POLICIES."""

from __future__ import annotations

from typing import Any, Dict, List

DEFAULT_POLICIES: List[Dict[str, Any]] = [
    {
        "id": "block-destructive-shell",
        "tool": "*",
        "action": "block",
        "condition": "arg_contains",
        "value": "rm -rf",
    },
    {
        "id": "block-fork-bomb",
        "tool": "*",
        "action": "block",
        "condition": "arg_contains",
        "value": ":(){",
    },
    {
        "id": "block-sql-destructive",
        "tool": "*",
        "action": "block",
        "condition": "arg_contains",
        "value": "DROP TABLE",
    },
    {
        "id": "block-sql-truncate",
        "tool": "*",
        "action": "block",
        "condition": "arg_contains",
        "value": "TRUNCATE",
    },
    {
        "id": "block-path-traversal",
        "tool": "*",
        "action": "block",
        "condition": "arg_contains",
        "value": "..\\",
    },
    {
        "id": "review-network-commands",
        "tool": "*",
        "action": "review",
        "condition": "arg_contains",
        "value": "curl ",
    },
]