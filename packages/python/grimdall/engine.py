"""Policy evaluation for tool calls.

Rules, ordering, and decision strings match the CLI hook runner
(``grimdall/packages/cli/hooks/pre-tool-use.js``):

1. Prompt-injection risk scores above 75 block immediately.
2. Otherwise the first matching policy file rule decides.
3. With no matching rule, the call is allowed by default.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from .defaults import DEFAULT_POLICIES
from .injection import RISK_THRESHOLD, risk_score

INJECTION_BLOCK = {"status": "blocked", "reason": "Injection detected", "policy_matched": "prompt-injection-scan"}


def _safe_json(value: Any) -> str:
    try:
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)
    except Exception:
        return str(value)


def _any_value_matches(value: Any, target: Any, mode: str) -> bool:
    if isinstance(value, list):
        return any(_any_value_matches(item, target, mode) for item in value)
    if isinstance(value, dict):
        return any(_any_value_matches(item, target, mode) for item in value.values())
    if mode == "equals":
        return value == target
    return str(value).find(str(target)) != -1


def _matches_tool(policy: Dict[str, Any], tool: str) -> bool:
    return policy.get("tool") in ("*", tool)


def _matches_condition(policy: Dict[str, Any], args: Any) -> bool:
    condition = policy.get("condition", "always")
    if condition == "always":
        return True
    if condition == "arg_equals":
        return _any_value_matches(args, policy.get("value"), "equals")
    if condition == "arg_contains":
        return _any_value_matches(args, policy.get("value"), "contains")
    return False


class PolicyEngine:
    """Evaluates tool calls against injection scoring and policy file rules."""

    def __init__(self, dot_grimdall: str) -> None:
        self._dot_grimdall = dot_grimdall
        self._policies: List[Dict[str, Any]] = self._load()

    def get_policies(self) -> List[Dict[str, Any]]:
        return list(self._policies)

    def evaluate(self, tool: str, arguments: Any) -> Dict[str, Any]:
        if risk_score(arguments) > RISK_THRESHOLD:
            return dict(INJECTION_BLOCK)

        for policy in self._policies:
            if not _matches_tool(policy, tool):
                continue
            if not _matches_condition(policy, arguments):
                continue
            action = policy.get("action")
            policy_id = str(policy.get("id", "unknown"))
            if action == "allow":
                return {"status": "allowed", "policy_matched": policy_id, "reason": 'Allowed by policy "{}"'.format(policy_id)}
            if action == "block":
                return {"status": "blocked", "policy_matched": policy_id, "reason": 'Blocked by policy "{}"'.format(policy_id)}
            return {
                "status": "review",
                "policy_matched": policy_id,
                "reason": 'Flagged for review by policy "{}" (proceeding)'.format(policy_id),
            }
        return {"status": "allowed"}

    def _load(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self._dot_grimdall):
            return list(DEFAULT_POLICIES)
        path = os.path.join(self._dot_grimdall, "policies.json")
        if not os.path.exists(path):
            return list(DEFAULT_POLICIES)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                parsed = json.load(handle)
            entries = parsed if isinstance(parsed, list) else []
            return [entry for entry in entries if isinstance(entry, dict)]
        except (OSError, ValueError):
            return list(DEFAULT_POLICIES)