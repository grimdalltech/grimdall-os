"""Inline guardrail policy merged on top of file-based policies.

``Policy`` mirrors the specced inline format::

    Policy(
        deny=["github_delete_repo"],
        rate_limit={"max": 10, "per": "minute"},
        budget={"max_spend": 50.0, "period": "day"},
        require_approval=["deploy_production"],
    )

Every rule is optional. ``rate_limit.per`` accepts ``"second"``,
``"minute"``, ``"hour"``, ``"day"`` or ``{"seconds": n}``. ``budget.period``
accepts ``"day"``, ``"week"``, ``"month"``, or ``"total"``. Both rules
accept an optional ``"tool"`` key to scope them to one tool.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple


class Policy:
    """Inline guardrail rules merged over the loaded policy file."""

    def __init__(
        self,
        deny: Optional[Sequence[str]] = None,
        rate_limit: Optional[Dict[str, Any]] = None,
        budget: Optional[Dict[str, Any]] = None,
        require_approval: Optional[Sequence[str]] = None,
    ) -> None:
        self.deny: Tuple[str, ...] = tuple(deny or ())
        self.rate_limit = rate_limit or {}
        self.budget = budget or {}
        self.require_approval: Tuple[str, ...] = tuple(require_approval or ())

    def requires_approval(self, tool: str) -> bool:
        return tool in self.require_approval or "*" in self.require_approval

    def is_denied(self, tool: str) -> bool:
        return tool in self.deny or "*" in self.deny

    def rate_limit_window_seconds(self) -> int:
        period = self.rate_limit.get("per", "minute")
        if isinstance(period, dict) and "seconds" in period:
            return int(period["seconds"])
        return {"second": 1, "minute": 60, "hour": 3600, "day": 86400}.get(str(period), 60)

    def rate_limit_max(self) -> int:
        return int(self.rate_limit.get("max", 0))

    def rate_limit_tool(self) -> Optional[str]:
        return self.rate_limit.get("tool")

    def budget_max_spend(self) -> float:
        return float(self.budget.get("max_spend", 0.0))

    def budget_period_seconds(self) -> Optional[int]:
        period = self.budget.get("period", "total")
        return {
            "day": 86400,
            "week": 604800,
            "month": 2592000,
            "total": None,
        }.get(str(period))

    def budget_tool(self) -> Optional[str]:
        return self.budget.get("tool")