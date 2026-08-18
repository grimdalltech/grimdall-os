"""The Guard: one decorator that protects any tool call.

Evaluation order per spec:

    identity/credential → policy rules → rate limits → budget → approval → execute

Every decision is appended to the same SHA-256 hash-chained audit as the
CLI hook events, with the exact entry format written by the Node SDK and
hook runner.

Approvals never fail open: ``require_approval`` tools prompt in the local
terminal (``[Allow/Deny/Allow 1h]``) and a timeout or a missing TTY denies
the call.
"""

from __future__ import annotations

import functools
import inspect
import json
import os
import time
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from .audit import AuditTrail
from .engine import PolicyEngine
from .masking import mask_secrets
from .policy import Policy

BLOCKING_STATUSES = frozenset(
    {
        "blocked",
        "denied",
        "rate_limited",
        "budget_exceeded",
        "identity_rejected",
        "approval_denied",
        "approval_timed_out",
    }
)

_DOWNGRADEABLE_STATUSES = frozenset(
    {"blocked", "denied", "rate_limited", "budget_exceeded", "identity_rejected"}
)

_APPROVAL_CACHE_SECONDS = 3600
_CONFIG_FILE = "config.json"
_SPEND_FILE = "spend.json"


class GrimdallBlockedError(Exception):
    """Raised when a tool call is rejected by a guardrail."""

    def __init__(self, decision: Dict[str, Any], tool: str) -> None:
        self.decision = decision
        self.tool = tool
        reason = decision.get("reason") or "no matching policy allows this call"
        super().__init__('[BLOCKED] Tool "{}" rejected: {}'.format(tool, reason))


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class Guard:
    """Local-only, zero-infrastructure guardrail for agent tool calls."""

    def __init__(
        self,
        project_dir: Optional[str] = None,
        *,
        mode: Optional[str] = None,
        approver: Optional[Callable[[str, Dict[str, Any]], str]] = None,
        approval_timeout_seconds: int = 120,
    ) -> None:
        self._project_dir = os.path.abspath(project_dir or os.getcwd())
        self._dot = os.path.join(self._project_dir, ".grimdall")
        self._lock = threading.RLock()
        self._ensure_defaults()
        self.audit = AuditTrail(os.path.join(self._dot, "audit.json"))
        self.engine = PolicyEngine(self._dot)
        self.policy = Policy()
        self._access_rules: List[Dict[str, Any]] = []
        self._approver = approver
        self._approval_timeout_seconds = int(approval_timeout_seconds)
        self._approval_cache: Dict[Tuple[str, str], float] = {}
        self._rate_buckets: Dict[str, List[float]] = {}
        self._mode = mode or self._read_mode()

    @property
    def mode(self) -> str:
        return self._mode

    # ------------------------------------------------------------------ config

    def add_policy(self, policy: Policy) -> None:
        """Merge an inline :class:`Policy` over the loaded file policies."""
        with self._lock:
            self.policy = policy

    def restrict(
        self,
        tool: str,
        *,
        users: Optional[List[str]] = None,
        roles: Optional[List[str]] = None,
        credential: Optional[str] = None,
    ) -> None:
        """Require identity or credential evidence before a tool may run."""
        with self._lock:
            self._access_rules.append(
                {
                    "tool": tool,
                    "users": list(users or []),
                    "roles": list(roles or []),
                    "credential": credential,
                }
            )

    def spend(self, tool: str, amount: float, *, reason: str = "spent") -> None:
        """Record metered spend for ``tool`` (ledger + audit chain)."""
        with self._lock:
            amount = round(float(amount), 6)
            ledger = self._load_json(_SPEND_FILE, [])
            entry = {"timestamp": _now_iso(), "tool": tool, "amount": amount}
            ledger.append(entry)
            self._write_json(_SPEND_FILE, ledger)
            self.audit.add_entry(
                {
                    "id": uuid.uuid4().hex,
                    "timestamp": _now_iso(),
                    "tool": tool,
                    "arguments_masked": {"amount": amount},
                    "decision": "spend",
                    "reason": "{} {}: ({})".format(reason, amount, tool),
                }
            )

    # --------------------------------------------------------------- pipeline

    def check(self, tool: str, record: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Run the full guardrail pipeline and return the decision dict.

        Decisions with a ``status`` in :data:`BLOCKING_STATUSES` must not
        execute. Non-blocking statuses are ``allowed``, ``review``,
        ``approved``, and ``would_block`` (audit mode).
        """
        record = dict(record or {})
        with self._lock:
            decision = self._check_access(tool, record)
            if decision is None:
                decision = self.engine.evaluate(tool, record)

            if decision["status"] in ("allowed", "review") and self.policy.is_denied(tool):
                decision = {"status": "denied", "reason": 'Denied by inline policy for tool "{}"'.format(tool)}

            if decision["status"] in ("allowed", "review"):
                rate_decision = self._check_rate_limit(tool)
                if rate_decision is not None:
                    decision = rate_decision

            if decision["status"] in ("allowed", "review"):
                budget_decision = self._check_budget(tool, record)
                if budget_decision is not None:
                    decision = budget_decision

            if decision["status"] in ("allowed", "review"):
                approval_decision = self._check_approval(tool, record)
                if approval_decision is not None:
                    decision = approval_decision

            if self._mode == "audit" and decision["status"] in _DOWNGRADEABLE_STATUSES:
                decision = dict(decision)
                decision["status"] = "would_block"

            self._log_decision(tool, record, decision)
            return dict(decision)

    def require_allowed(self, tool: str, record: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Run the pipeline, raising :class:`GrimdallBlockedError` on a block.

        Useful for framework adapters that guard outside a decorator.
        """
        decision = self.check(tool, record)
        if decision["status"] in BLOCKING_STATUSES:
            raise GrimdallBlockedError(decision, tool)
        return decision

    # ----------------------------------------------------------------- wrapper

    def wrap(self, fn: Optional[Callable[..., Any]] = None, *, tool: Optional[str] = None):
        """Wrap a function so every call is guarded before execution.

        Works on sync and async callables. A single dict argument is treated
        as the call record; otherwise arguments are packed into an ``args``
        list, mirroring the CLI hook entry format.
        """
        if fn is None:
            return lambda f: self.wrap(f, tool=tool)

        name = tool or getattr(fn, "__name__", "unknown_tool")

        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def guarded_async(*args: Any, **kwargs: Any) -> Any:
                record = self._build_record(args, kwargs)
                decision = self.check(name, record)
                if decision["status"] in BLOCKING_STATUSES:
                    raise GrimdallBlockedError(decision, name)
                result = await fn(*args, **kwargs)
                self._record_estimated_cost(name, record)
                return result

            return guarded_async

        @functools.wraps(fn)
        def guarded(*args: Any, **kwargs: Any) -> Any:
            record = self._build_record(args, kwargs)
            decision = self.check(name, record)
            if decision["status"] in BLOCKING_STATUSES:
                raise GrimdallBlockedError(decision, name)
            result = fn(*args, **kwargs)
            self._record_estimated_cost(name, record)
            return result

        return guarded

    # ------------------------------------------------------------------ stages

    def _check_access(self, tool: str, record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self._access_rules:
            return None
        for rule in self._access_rules:
            if rule["tool"] not in ("*", tool):
                continue
            if rule["users"] or rule["roles"]:
                identity = record.get("identity")
                if isinstance(identity, str):
                    identity = {"user": identity, "roles": []}
                identity = identity if isinstance(identity, dict) else {}
                user = str(identity.get("user") or "")
                roles = [str(role) for role in (identity.get("roles") or [])]
                if rule["users"] and user not in rule["users"]:
                    return {
                        "status": "identity_rejected",
                        "reason": 'User "{}" not authorized for tool "{}"'.format(user or "anonymous", tool),
                    }
                if rule["roles"] and not set(rule["roles"]).intersection(roles):
                    return {
                        "status": "identity_rejected",
                        "reason": 'Role requirements not met for tool "{}"'.format(tool),
                    }
            if rule["credential"] and not os.environ.get(rule["credential"]):
                return {
                    "status": "identity_rejected",
                    "reason": 'Missing credential env var "{}" for tool "{}"'.format(rule["credential"], tool),
                }
        return None

    def _check_rate_limit(self, tool: str) -> Optional[Dict[str, Any]]:
        if not self.policy.rate_limit or not self.policy.rate_limit_max():
            return None
        key = self.policy.rate_limit_tool() or "global"
        window = self.policy.rate_limit_window_seconds()
        now = time.time()
        bucket = [stamp for stamp in self._rate_buckets.get(key, []) if now - stamp < window]
        if len(bucket) >= self.policy.rate_limit_max():
            self._rate_buckets[key] = bucket
            return {
                "status": "rate_limited",
                "reason": 'Rate limit hit for "{}" ({} in {}s)'.format(key, self.policy.rate_limit_max(), window),
            }
        bucket.append(now)
        self._rate_buckets[key] = bucket
        return None

    def _check_budget(self, tool: str, record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.policy.budget or not self.policy.budget_max_spend():
            return None
        tool_filter = self.policy.budget_tool()
        if tool_filter and tool_filter not in ("*", tool):
            return None
        period_seconds = self.policy.budget_period_seconds()
        max_spend = self.policy.budget_max_spend()
        now = time.time()
        cutoff = None if period_seconds is None else now - period_seconds
        spent = 0.0
        for entry in self._load_json(_SPEND_FILE, []):
            stamp = self._parse_timestamp(entry.get("timestamp"))
            if stamp is None:
                continue
            if cutoff is not None and stamp < cutoff:
                continue
            if tool_filter and entry.get("tool") not in (tool_filter,):
                continue
            spent += float(entry.get("amount") or 0.0)
        estimate = self._estimated_cost(record)
        if spent + estimate > max_spend:
            return {
                "status": "budget_exceeded",
                "reason": "Budget exceeded: {:.4f} + {:.4f} > {:.4f}".format(spent, estimate, max_spend),
            }
        return None

    def _check_approval(self, tool: str, record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.policy.requires_approval(tool):
            return None
        identity = self._identity_key(record)
        cache_key = (tool, identity)
        cached = self._approval_cache.get(cache_key)
        if cached is not None and cached > time.time():
            return {
                "status": "approved",
                "reason": "Approved by cached approval (allow 1h)",
            }

        self._log_event(tool, record, "pending_approval", 'Awaiting approval for tool "{}"'.format(tool))
        verdict = self._approval_verdict(tool, record)
        if verdict in ("allow", "a", "y"):
            return {"status": "approved", "reason": "Approved by human approval"}
        if verdict in ("allow_1h", "1", "h"):
            self._approval_cache[cache_key] = time.time() + _APPROVAL_CACHE_SECONDS
            return {"status": "approved", "reason": "Approved by human approval (allow 1h)"}
        if verdict in ("deny", "d", "n"):
            return {
                "status": "approval_denied",
                "reason": 'Approval denied for tool "{}"'.format(tool),
            }
        return {
            "status": "approval_timed_out",
            "reason": 'Approval timed out for tool "{}" (deny on timeout)'.format(tool),
        }

    # ---------------------------------------------------------------- helpers

    def _approval_verdict(self, tool: str, record: Dict[str, Any]) -> str:
        if self._approver is not None:
            try:
                return str(self._approver(tool, record)).strip().lower()
            except Exception:
                return "deny"
        return self._prompt_local(tool, record)

    def _prompt_local(self, tool: str, record: Dict[str, Any]) -> str:
        prompt = (
            '[GRIMDALL] Approve tool "{}" ({})? [Allow/Deny/Allow 1h] ({}s): '
            .format(tool, json.dumps(mask_secrets(record), default=str), self._approval_timeout_seconds)
        )
        try:
            if not os.isatty(0):
                return "timeout"
            print(prompt, end="", flush=True)
            return self._timed_stdin(self._approval_timeout_seconds).strip().lower()
        except Exception:
            return "timeout"

    @staticmethod
    def _timed_stdin(timeout_seconds: int) -> str:
        deadline = time.time() + timeout_seconds
        if os.name == "nt":
            import msvcrt

            chars: List[str] = []
            while time.time() < deadline:
                if msvcrt.kbhit():
                    char = msvcrt.getwch()
                    if char in ("\r", "\n"):
                        return "".join(chars)
                    if char in ("\x00", "\xe0"):
                        msvcrt.getwch()
                        continue
                    chars.append(char)
                else:
                    time.sleep(0.05)
            return ""
        import select

        ready, _, _ = select.select([0], [], [], max(0, deadline - time.time()))
        if not ready:
            return ""
        return os.read(0, 4096).decode("utf-8", "replace")

    def _log_decision(self, tool: str, record: Dict[str, Any], decision: Dict[str, Any]) -> None:
        self.audit.add_entry(
            {
                "id": uuid.uuid4().hex,
                "timestamp": _now_iso(),
                "tool": tool,
                "arguments_masked": mask_secrets(record),
                "decision": decision["status"],
                "reason": decision.get("reason"),
                "policy_matched": decision.get("policy_matched"),
            }
        )

    def _log_event(
        self,
        tool: str,
        record: Dict[str, Any],
        decision: str,
        reason: str,
        policy_matched: Optional[str] = None,
    ) -> None:
        self.audit.add_entry(
            {
                "id": uuid.uuid4().hex,
                "timestamp": _now_iso(),
                "tool": tool,
                "arguments_masked": mask_secrets(record),
                "decision": decision,
                "reason": reason,
                "policy_matched": policy_matched,
            }
        )

    def _record_estimated_cost(self, tool: str, record: Dict[str, Any]) -> None:
        estimate = self._estimated_cost(record)
        if estimate > 0:
            self.spend(tool, estimate, reason="estimated spend")

    @staticmethod
    def _estimated_cost(record: Dict[str, Any]) -> float:
        try:
            cost = float(record.get("cost") or 0.0)
            return max(0.0, cost)
        except (TypeError, ValueError):
            return 0.0

    def _identity_key(self, record: Dict[str, Any]) -> str:
        identity = record.get("identity")
        if isinstance(identity, dict):
            return str(identity.get("user") or identity.get("roles") or "")
        return str(identity or "")

    @staticmethod
    def _build_record(args: Tuple[Any, ...], kwargs: Dict[str, Any]) -> Dict[str, Any]:
        if not kwargs and len(args) == 1:
            if isinstance(args[0], dict):
                return dict(args[0])
            return {"args": args[0]}
        if not args and kwargs:
            return dict(kwargs)
        record: Dict[str, Any] = {"args": list(args)}
        record.update(kwargs)
        return record

    def _read_mode(self) -> str:
        parsed = self._load_json(_CONFIG_FILE, {})
        return "audit" if parsed.get("mode") == "audit" else "enforce"

    def _ensure_defaults(self) -> None:
        from .defaults import DEFAULT_POLICIES

        os.makedirs(self._dot, exist_ok=True)
        config_path = os.path.join(self._dot, _CONFIG_FILE)
        if not os.path.exists(config_path):
            self._write_json(
                _CONFIG_FILE,
                {
                    "version": 1,
                    "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
                    "WEBHOOK_PORT": 3001,
                },
            )
        policies_path = os.path.join(self._dot, "policies.json")
        if not os.path.exists(policies_path):
            self._write_json("policies.json", DEFAULT_POLICIES)
        audit_path = os.path.join(self._dot, "audit.json")
        if not os.path.exists(audit_path):
            self._write_json("audit.json", [])
        if not os.path.exists(os.path.join(self._dot, _SPEND_FILE)):
            self._write_json(_SPEND_FILE, [])

    def _load_json(self, name: str, fallback: Any) -> Any:
        path = os.path.join(self._dot, name)
        if not os.path.exists(path):
            return fallback
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return fallback

    def _write_json(self, name: str, value: Any) -> None:
        path = os.path.join(self._dot, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(value, indent=2) + "\n")

    @staticmethod
    def _parse_timestamp(value: Any) -> Optional[float]:
        if not isinstance(value, str):
            return None
        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized).timestamp()
        except ValueError:
            return None