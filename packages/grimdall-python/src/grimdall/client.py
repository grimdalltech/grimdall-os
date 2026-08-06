from __future__ import annotations

import os
import re
from collections.abc import Callable
from typing import Any, TypeVar

import requests

REDACTED = "[REDACTED]"
SENSITIVE_KEY_PATTERN = re.compile(
    r"(^|[_-])(authorization|api[-_]?key|access[-_]?token|auth[-_]?token|bearer|cookie|credential|email|jwt|mobile|pass(code|word)?|phone|secret|session|ssn|token)([_-]|$)",
    re.IGNORECASE,
)
EMAIL_PATTERN = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
TOKEN_PATTERN = re.compile(
    r"\b(gh[pousr]_[A-Za-z0-9_]{20,}|grimdall_sk_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]+)\b"
)
PHONE_PATTERN = re.compile(r"(?:\+?\d[\s().-]*){10,}")

T = TypeVar("T")
ArgumentSanitizer = Callable[[dict[str, Any]], Any]


def _contains_sensitive_string(value: str) -> bool:
    return bool(
        EMAIL_PATTERN.search(value)
        or TOKEN_PATTERN.search(value)
        or PHONE_PATTERN.search(value)
    )


def _redact_value(value: Any, seen: set[int]) -> Any:
    if value is None:
        return value

    if isinstance(value, str):
        return REDACTED if _contains_sensitive_string(value) else value

    if isinstance(value, (bool, int, float)):
        return value

    value_id = id(value)
    if value_id in seen:
        return REDACTED

    if isinstance(value, list):
        seen.add(value_id)
        return [_redact_value(item, seen) for item in value]

    if isinstance(value, tuple):
        seen.add(value_id)
        return [_redact_value(item, seen) for item in value]

    if isinstance(value, dict):
        seen.add(value_id)
        return {
            key: REDACTED
            if SENSITIVE_KEY_PATTERN.search(str(key))
            else _redact_value(item, seen)
            for key, item in value.items()
        }

    return value


def redact_sensitive_arguments(arguments: dict[str, Any] | None = None) -> Any:
    return _redact_value(arguments or {}, set())


class GrimdallPolicyError(RuntimeError):
    def __init__(self, message: str, result: dict[str, Any]):
        super().__init__(message)
        self.result = result


class Grimdall:
    def __init__(
        self,
        api_key: str | None = None,
        endpoint: str | None = None,
        timeout: float = 15,
        argument_sanitizer: ArgumentSanitizer | None = redact_sensitive_arguments,
    ) -> None:
        self.api_key = api_key or os.getenv("GRIMDALL_API_KEY")
        self.endpoint = endpoint or os.getenv("GRIMDALL_ENDPOINT")
        if not self.endpoint:
            raise ValueError(
                "GRIMDALL_ENDPOINT is required (set it in the environment or pass endpoint=)."
            )
        self.timeout = timeout
        self.argument_sanitizer = argument_sanitizer

    def check(
        self,
        tool: str,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        safe_arguments = arguments or {}
        if self.argument_sanitizer is not None:
            safe_arguments = self.argument_sanitizer(safe_arguments)

        headers = {"Content-Type": "application/json"}

        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        response = requests.post(
            self.endpoint,
            headers=headers,
            json={"tool": tool, "arguments": safe_arguments},
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def assert_allowed(
        self,
        tool: str,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result = self.check(tool, arguments)

        if result.get("status") == "blocked":
            raise GrimdallPolicyError(
                result.get("reason", "Blocked by Grimdall policy"),
                result,
            )

        return result

    def guard_tool(
        self,
        tool: str,
        handler: Callable[[dict[str, Any]], T],
    ) -> Callable[[dict[str, Any] | None], T]:
        def guarded(arguments: dict[str, Any] | None = None) -> T:
            safe_arguments = arguments or {}
            self.assert_allowed(tool, safe_arguments)
            return handler(safe_arguments)

        return guarded
