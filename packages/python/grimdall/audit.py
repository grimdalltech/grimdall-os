"""Tamper-evident audit trail backed by a SHA-256 hash chain.

Appends and verifies entries in the exact format written by the Node.js
SDK and the CLI hook runner, so the Python Guard can share one
``.grimdall/audit.json`` with them:

- The first entry anchors to the literal hash ``GENESIS``.
- Each entry's ``current_hash`` is ``sha256(compact-json(entryWithoutHashFields) + previousHash)``.
- Compact JSON omits keys whose values are ``None``, matching
  ``JSON.stringify`` semantics on the Node side.

Verification replays the chain from the start and raises on any mismatch,
reordering, or tampering.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from typing import Any, Dict, List, Optional

GENESIS_HASH = "GENESIS"
AUDIT_FILE_NAME = "audit.json"

_PAYLOAD_KEYS = ["id", "timestamp", "tool", "arguments_masked", "decision", "reason", "policy_matched"]
_ENTRY_KEYS = _PAYLOAD_KEYS + ["previous_hash", "current_hash"]


def _compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)


def sha256(input_text: str) -> str:
    return hashlib.sha256(input_text.encode("utf-8")).hexdigest()


def _compact_payload(entry: Dict[str, Any]) -> str:
    payload: Dict[str, Any] = {}
    for key in _PAYLOAD_KEYS:
        value = entry.get(key)
        if value is not None:
            payload[key] = value
    return _compact(payload)


class AuditError(Exception):
    """Raised when the audit chain fails verification."""


class AuditTrail:
    """Hash-chained audit log stored as a pretty-printed JSON array."""

    def __init__(self, workspace_path: str) -> None:
        self._file_path = self._resolve_audit_path(workspace_path)
        self._lock = threading.RLock()
        self._entries: List[Dict[str, Any]] = self._load()

    @property
    def file_path(self) -> str:
        return self._file_path

    def add_entry(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        """Append an entry (without hash fields) and chain it to the log."""
        with self._lock:
            previous_hash = self._entries[-1]["current_hash"] if self._entries else GENESIS_HASH
            compact = _compact_payload(entry)
            current_hash = sha256(compact + previous_hash)
            full_entry: Dict[str, Any] = {}
            for key in _PAYLOAD_KEYS:
                value = entry.get(key)
                if value is not None:
                    full_entry[key] = value
            full_entry["previous_hash"] = previous_hash
            full_entry["current_hash"] = current_hash
            self._entries.append(full_entry)
            self._persist()
            return full_entry

    def verify(self) -> None:
        """Replay the chain; raise :class:`AuditError` on any inconsistency."""
        with self._lock:
            previous_hash = GENESIS_HASH
            for entry in self._entries:
                entry_id = entry.get("id", "<unknown>")
                if entry.get("previous_hash") != previous_hash:
                    raise AuditError(
                        'Chain broken at entry "{}": previous_hash mismatch'.format(entry_id)
                    )
                if sha256(_compact_payload(entry) + previous_hash) != entry.get("current_hash"):
                    raise AuditError(
                        'Hash mismatch at entry "{}": tampering detected'.format(entry_id)
                    )
                previous_hash = entry["current_hash"]

    def entries_count(self) -> int:
        with self._lock:
            return len(self._entries)

    def get_entries(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._entries)

    def _load(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self._file_path):
            return []
        try:
            with open(self._file_path, "r", encoding="utf-8") as handle:
                parsed = json.load(handle)
            return [entry for entry in parsed if isinstance(entry, dict)] if isinstance(parsed, list) else []
        except (OSError, ValueError):
            return []

    def _persist(self) -> None:
        directory = os.path.dirname(self._file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(self._file_path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(self._entries, indent=2) + "\n")

    @staticmethod
    def _resolve_audit_path(workspace_path: str) -> str:
        workspace_path = os.fspath(workspace_path)
        if workspace_path.endswith(".json"):
            return workspace_path
        if os.path.basename(workspace_path) == AUDIT_FILE_NAME:
            return workspace_path
        return os.path.join(workspace_path, ".grimdall", AUDIT_FILE_NAME)