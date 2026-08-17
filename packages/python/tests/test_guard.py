"""Guard behavior tests: block, rate limit, budget, approvals, identity,
audit mode, masking, async, and zero-config.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from contextlib import contextmanager

from grimdall import Guard, GrimdallBlockedError, Policy


@contextmanager
def project_dir():
    directory = tempfile.mkdtemp(prefix="grimdall-guard-")
    original = os.getcwd()
    os.chdir(directory)
    try:
        yield directory
    finally:
        os.chdir(original)


def read_json(relative: str) -> object:
    with open(relative, "r", encoding="utf-8") as handle:
        return json.load(handle)


class GuardCoreTest(unittest.TestCase):
    def test_zero_config_creates_dot_grimdall(self):
        with project_dir():
            guard = Guard()
            self.assertTrue(os.path.exists(".grimdall/audit.json"))
            self.assertTrue(os.path.exists(".grimdall/policies.json"))
            self.assertTrue(os.path.exists(".grimdall/config.json"))
            self.assertTrue(os.path.exists(".grimdall/spend.json"))
            guard.audit.verify()

    def test_allowed_call_runs_and_is_logged(self):
        with project_dir():
            guard = Guard()

            @guard.wrap
            def run_shell(command: str) -> str:
                return "[mock] executed: {}".format(command)

            self.assertEqual(run_shell("ls -la"), "[mock] executed: ls -la")
            entries = guard.audit.get_entries()
            self.assertEqual(entries[-1]["decision"], "allowed")
            guard.audit.verify()

    def test_destructive_call_is_blocked_and_logged(self):
        with project_dir():
            guard = Guard()

            @guard.wrap
            def run_shell(command: str) -> str:
                return "[mock] executed: {}".format(command)

            with self.assertRaises(GrimdallBlockedError) as raised:
                run_shell("rm -rf /")
            self.assertEqual(raised.exception.decision["status"], "blocked")
            self.assertEqual(raised.exception.decision["policy_matched"], "block-destructive-shell")
            entry = guard.audit.get_entries()[-1]
            self.assertEqual(entry["decision"], "blocked")
            self.assertEqual(entry["policy_matched"], "block-destructive-shell")
            guard.audit.verify()

    def test_injection_payload_is_blocked(self):
        with project_dir():
            guard = Guard()

            @guard.wrap
            def run_shell(command: str) -> str:
                return command

            with self.assertRaises(GrimdallBlockedError) as raised:
                run_shell("rm -rf / && DROP TABLE users")
            self.assertEqual(raised.exception.decision["policy_matched"], "prompt-injection-scan")

    def test_inline_deny_overrides_file_allow(self):
        with project_dir():
            guard = Guard()
            guard.add_policy(Policy(deny=["safe_tool"]))

            @guard.wrap
            def safe_tool(value: str) -> str:
                return value

            with self.assertRaises(GrimdallBlockedError) as raised:
                safe_tool("anything")
            self.assertEqual(raised.exception.decision["status"], "denied")

    def test_rate_limit_blocks_after_max(self):
        with project_dir():
            guard = Guard()
            guard.add_policy(Policy(rate_limit={"max": 2, "per": "minute"}))

            @guard.wrap
            def listener(_: dict) -> str:
                return "ok"

            self.assertEqual(listener({"event": "a"}), "ok")
            self.assertEqual(listener({"event": "b"}), "ok")
            with self.assertRaises(GrimdallBlockedError) as raised:
                listener({"event": "c"})
            self.assertEqual(raised.exception.decision["status"], "rate_limited")

    def test_rate_limit_sliding_window_recovers(self):
        with project_dir():
            guard = Guard()
            guard.add_policy(Policy(rate_limit={"max": 1, "per": {"seconds": 2}}))

            @guard.wrap
            def listener(_: dict) -> str:
                return "ok"

            listener({"event": "a"})
            with self.assertRaises(GrimdallBlockedError):
                listener({"event": "b"})
            time.sleep(2.1)
            self.assertEqual(listener({"event": "c"}), "ok")

    def test_budget_cap_blocks_projected_spend(self):
        with project_dir():
            guard = Guard()
            guard.add_policy(Policy(budget={"max_spend": 10.0, "period": "total"}))

            @guard.wrap
            def call_api(record: dict) -> str:
                return "ok"

            self.assertEqual(call_api({"endpoint": "a", "cost": 6.0}), "ok")
            with self.assertRaises(GrimdallBlockedError) as raised:
                call_api({"endpoint": "b", "cost": 6.0})
            self.assertEqual(raised.exception.decision["status"], "budget_exceeded")
            ledger = read_json(".grimdall/spend.json")
            self.assertEqual(len(ledger), 1)
            self.assertEqual(ledger[0]["amount"], 6.0)
            self.assertEqual(guard.audit.get_entries()[-1]["decision"], "budget_exceeded")
            guard.audit.verify()

    def test_spend_metering_records_events_in_chain(self):
        with project_dir():
            guard = Guard()
            guard.spend("llm_call", 0.02, reason="token cost")
            entries = guard.audit.get_entries()
            self.assertEqual(entries[-1]["decision"], "spend")
            self.assertEqual(entries[-1]["tool"], "llm_call")
            guard.audit.verify()

    def test_approval_deny_blocks_execution(self):
        with project_dir():
            guard = Guard(approver=lambda tool, record: "deny")
            guard.add_policy(Policy(require_approval=["deploy_production"]))

            @guard.wrap
            def deploy_production(site: str) -> str:
                return "deployed"

            with self.assertRaises(GrimdallBlockedError) as raised:
                deploy_production("example.com")
            self.assertEqual(raised.exception.decision["status"], "approval_denied")
            decisions = [entry["decision"] for entry in guard.audit.get_entries()]
            self.assertIn("pending_approval", decisions)
            self.assertIn("approval_denied", decisions)
            guard.audit.verify()

    def test_approval_timeout_denies_never_fail_open(self):
        with project_dir():
            guard = Guard(approver=lambda tool, record: "timeout")
            guard.add_policy(Policy(require_approval=["deploy_production"]))

            @guard.wrap
            def deploy_production(site: str) -> str:
                return "deployed"

            with self.assertRaises(GrimdallBlockedError) as raised:
                deploy_production("example.com")
            self.assertEqual(raised.exception.decision["status"], "approval_timed_out")
            guard.audit.verify()

    def test_approval_allow_runs_and_records_approved(self):
        with project_dir():
            guard = Guard(approver=lambda tool, record: "allow")
            guard.add_policy(Policy(require_approval=["deploy_production"]))

            @guard.wrap
            def deploy_production(site: str) -> str:
                return "deployed"

            self.assertEqual(deploy_production("example.com"), "deployed")
            decisions = [entry["decision"] for entry in guard.audit.get_entries()]
            self.assertIn("pending_approval", decisions)
            self.assertIn("approved", decisions)

    def test_approval_allow_1h_is_cached(self):
        with project_dir():
            calls = []

            def approver(tool: str, record: dict) -> str:
                calls.append(tool)
                return "allow_1h"

            guard = Guard(approver=approver)
            guard.add_policy(Policy(require_approval=["deploy_production"]))

            @guard.wrap
            def deploy_production(site: str) -> str:
                return "deployed"

            deploy_production("a.com")
            deploy_production("b.com")
            self.assertEqual(len(calls), 1)

    def test_approval_timeout_in_non_tty_environment(self):
        # unittest runs with stdin not a TTY: the pipeline must deny on
        # timeout instead of failing open.
        with project_dir():
            guard = Guard(approval_timeout_seconds=1)
            guard.add_policy(Policy(require_approval=["deploy_production"]))

            @guard.wrap
            def deploy_production(site: str) -> str:
                return "deployed"

            with self.assertRaises(GrimdallBlockedError) as raised:
                deploy_production("example.com")
            self.assertEqual(raised.exception.decision["status"], "approval_timed_out")

    def test_identity_restriction_blocks_unknown_user(self):
        with project_dir():
            guard = Guard()
            guard.restrict("admin_panel", users=["alice"])

            @guard.wrap
            def admin_panel(record: dict) -> str:
                return "admin"

            with self.assertRaises(GrimdallBlockedError) as raised:
                admin_panel({"identity": {"user": "bob"}, "query": "list"})
            self.assertEqual(raised.exception.decision["status"], "identity_rejected")
            self.assertEqual(admin_panel({"identity": {"user": "alice"}, "query": "list"}), "admin")

    def test_role_restriction(self):
        with project_dir():
            guard = Guard()
            guard.restrict("finance_tool", roles=["admin"])

            @guard.wrap
            def finance_tool(record: dict) -> str:
                return "ok"

            with self.assertRaises(GrimdallBlockedError):
                finance_tool({"identity": {"roles": ["viewer"]}})
            self.assertEqual(finance_tool({"identity": {"roles": ["admin"]}}), "ok")

    def test_credential_restriction_requires_env_var(self):
        with project_dir():
            guard = Guard()
            guard.restrict("stripe_tool", credential="GRIMDALL_TEST_STRIPE_KEY")
            os.environ.pop("GRIMDALL_TEST_STRIPE_KEY", None)

            @guard.wrap
            def stripe_tool(record: dict) -> str:
                return "ok"

            with self.assertRaises(GrimdallBlockedError) as raised:
                stripe_tool({"amount": 5})
            self.assertEqual(raised.exception.decision["status"], "identity_rejected")
            os.environ["GRIMDALL_TEST_STRIPE_KEY"] = "sk_test_x"
            self.assertEqual(stripe_tool({"amount": 5}), "ok")

    def test_audit_mode_logs_would_block_and_proceeds(self):
        with project_dir():
            os.makedirs(".grimdall", exist_ok=True)
            config = {"version": 1, "mode": "audit"}
            with open(".grimdall/config.json", "w", encoding="utf-8") as handle:
                json.dump(config, handle)
            guard = Guard()

            @guard.wrap
            def run_shell(command: str) -> str:
                return "[mock] executed: {}".format(command)

            self.assertEqual(run_shell("rm -rf /"), "[mock] executed: rm -rf /")
            entry = guard.audit.get_entries()[-1]
            self.assertEqual(entry["decision"], "would_block")
            self.assertEqual(guard.mode, "audit")

    def test_secrets_are_masked_in_audit(self):
        with project_dir():
            guard = Guard()

            @guard.wrap
            def call_api(record: dict) -> str:
                return "called"

            call_api({"apiKey": "sk-" + "a" * 48})
            stored = json.dumps(guard.audit.get_entries()[-1]["arguments_masked"])
            self.assertNotIn("sk-", stored)
            self.assertIn("REDACTED_KEY", stored)
            guard.audit.verify()

    def test_async_wrap_blocks_and_allows(self):
        with project_dir():
            import asyncio

            guard = Guard()

            @guard.wrap
            async def run_shell(command: str) -> str:
                return "[mock] executed: {}".format(command)

            async def scenario() -> None:
                self.assertEqual(await run_shell("ls -la"), "[mock] executed: ls -la")
                with self.assertRaises(GrimdallBlockedError):
                    await run_shell("rm -rf /")

            asyncio.run(scenario())

    def test_record_tool_override_and_args_nesting(self):
        with project_dir():
            guard = Guard()

            @guard.wrap(tool="runShell")
            def any_name(args: tuple) -> str:
                return "ok"

            with self.assertRaises(GrimdallBlockedError):
                any_name({"command": "rm -rf /"})
            self.assertEqual(any_name({"command": "ls"}), "ok")

    def test_require_allowed_usable_outside_decorator(self):
        with project_dir():
            guard = Guard()
            with self.assertRaises(GrimdallBlockedError):
                guard.require_allowed("runShell", {"command": "rm -rf /"})
            self.assertEqual(guard.require_allowed("runShell", {"command": "ls"})["status"], "allowed")


if __name__ == "__main__":
    unittest.main()