"""Grimdall: local-only runtime guardrails for AI agent tool calls.

One decorator. Any framework. Zero infra. No signup, no proxy, no network
unless you opted into the cloud dashboard. Policies, rate limits, budgets,
approvals, and a tamper-evident audit trail all live in your project.

Usage::

    from grimdall import Guard, Policy, generate_keypair, verify_signature

    guard = Guard()
    guard.add_policy(Policy(deny=["delete_repo"]))

    @guard.wrap
    def run_shell(command: str) -> str:
        return f"[mock] executed: {command}"
"""

from __future__ import annotations

from .identity import generate_keypair, load_keypair, verify_signature, fingerprint_from_public_key
from .audit import AuditError, AuditTrail, GENESIS_HASH, sha256
from .engine import PolicyEngine
from .guard import BLOCKING_STATUSES, GrimdallBlockedError, Guard
from .policy import Policy

__version__ = "0.3.3"

__all__ = [
    "AuditError",
    "AuditTrail",
    "BLOCKING_STATUSES",
    "GENESIS_HASH",
    "GrimdallBlockedError",
    "Guard",
    "Policy",
    "PolicyEngine",
    "sha256",
    "__version__",
    "generate_keypair",
    "load_keypair",
    "verify_signature",
    "fingerprint_from_public_key",
]
