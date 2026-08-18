"""Secret masking for audit logs.

Mirrors the redaction rules of the Node.js core and the CLI hook runner so
entries written by any Grimdall surface are masked identically.
"""

from __future__ import annotations

import re
from typing import Any

_SECRET_PATTERNS = [
    (re.compile(r"sk-[A-Za-z0-9]{16,}"), "[REDACTED_KEY]"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "[REDACTED_AWS]"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), "[REDACTED_GH]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._~+/=\-]{10,}", re.IGNORECASE), "[REDACTED_BEARER]"),
]


def mask_secrets(value: Any) -> Any:
    """Deep-clone ``value`` with secret-looking strings redacted.

    The input is never mutated. Strings are redacted with the same patterns
    and replacement tokens used by grimdall-core.
    """
    if isinstance(value, str):
        output = value
        for pattern, replacement in _SECRET_PATTERNS:
            output = pattern.sub(replacement, output)
        return output
    if isinstance(value, list):
        return [mask_secrets(item) for item in value]
    if isinstance(value, dict):
        return {key: mask_secrets(item) for key, item in value.items()}
    return value