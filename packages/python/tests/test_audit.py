"""Audit trail tests, including cross-SDK chain compatibility with the
CLI hook runner written in Node.js.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from grimdall import AuditError, AuditTrail, GENESIS_HASH, sha256

HOOK_RUNNER = (
    Path(__file__).resolve().parents[2] / "cli" / "hooks" / "pre-tool-use.js"
)


class AuditTrailTest(unittest.TestCase):
    def make_dir(self) -> str:
        return tempfile.mkdtemp(prefix="grimdall-audit-")

    def test_first_entry_anchors_to_genesis(self):
        trail = AuditTrail(self.make_dir())
        entry = trail.add_entry(
            {"id": "a", "timestamp": "2026-01-01T00:00:00.000Z", "tool": "runShell", "arguments_masked": {"args": ["ls"]}, "decision": "allowed"}
        )
        self.assertEqual(entry["previous_hash"], GENESIS_HASH)
        trail.verify()
        self.assertEqual(trail.entries_count(), 1)

    def test_chain_detects_tampering(self):
        directory = self.make_dir()
        trail = AuditTrail(directory)
        trail.add_entry({"id": "a", "timestamp": "t1", "tool": "runShell", "arguments_masked": {}, "decision": "allowed"})
        trail.add_entry({"id": "b", "timestamp": "t2", "tool": "runShell", "arguments_masked": {}, "decision": "allowed"})
        with open(trail.file_path, "r", encoding="utf-8") as handle:
            parsed = json.load(handle)
        parsed[1]["decision"] = "blocked"
        with open(trail.file_path, "w", encoding="utf-8") as handle:
            json.dump(parsed, handle, indent=2)
        with self.assertRaises(AuditError):
            AuditTrail(directory).verify()

    def test_chain_detects_removed_entry(self):
        directory = self.make_dir()
        trail = AuditTrail(directory)
        trail.add_entry({"id": "a", "timestamp": "t1", "tool": "runShell", "arguments_masked": {}, "decision": "allowed"})
        trail.add_entry({"id": "b", "timestamp": "t2", "tool": "runShell", "arguments_masked": {}, "decision": "blocked"})
        with open(trail.file_path, "r", encoding="utf-8") as handle:
            parsed = json.load(handle)
        with open(trail.file_path, "w", encoding="utf-8") as handle:
            json.dump(parsed[1:], handle, indent=2)
        self.assertRaises(AuditError, AuditTrail(directory).verify)

    def test_reloaded_trail_verifies(self):
        directory = self.make_dir()
        trail = AuditTrail(directory)
        for index in range(3):
            trail.add_entry({"id": str(index), "timestamp": "t{}".format(index), "tool": "runShell", "arguments_masked": {"args": [index]}, "decision": "allowed"})
        self.assertEqual(AuditTrail(directory).entries_count(), 3)
        AuditTrail(directory).verify()

    def test_omits_none_keys_from_payload(self):
        entry = {"id": "x", "timestamp": "t", "tool": "runShell", "arguments_masked": {}, "decision": "allowed", "reason": None, "policy_matched": None}
        directory = self.make_dir()
        trail = AuditTrail(directory)
        stored = trail.add_entry(entry)
        self.assertNotIn("reason", stored)
        self.assertNotIn("policy_matched", stored)
        trail.verify()

    @unittest.skipUnless(
        shutil.which("node") and HOOK_RUNNER.exists(),
        "node CLI hook runner not available",
    )
    def test_node_cli_hook_entries_verify_with_python_appended_chain(self):
        directory = self.make_dir()
        dot = os.path.join(directory, ".grimdall")
        os.makedirs(dot, exist_ok=True)
        with open(os.path.join(dot, "config.json"), "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "mode": "enforce"}, handle)
        with open(os.path.join(dot, "audit.json"), "w", encoding="utf-8") as handle:
            json.dump([], handle)
        with open(os.path.join(dot, "policies.json"), "w", encoding="utf-8") as handle:
            json.dump([], handle)

        payload = json.dumps({"tool_name": "runShell", "tool_input": {"cmd": "ls -la"}})
        subprocess.run(
            ["node", str(HOOK_RUNNER.resolve()), "--agent", "claude", "--project", directory],
            input=payload.encode("utf-8"),
            check=True,
            capture_output=True,
        )

        trail = AuditTrail(directory)
        self.assertEqual(trail.entries_count(), 1)
        self.assertEqual(trail.get_entries()[0]["decision"], "allowed")

        trail.add_entry({"id": "py-1", "timestamp": "2026-01-01T00:00:00.000Z", "tool": "runShell", "arguments_masked": {"args": ["echo hi"]}, "decision": "allowed", "reason": "Allowed by policy"})
        trail.add_entry({"id": "py-2", "timestamp": "2026-01-01T00:00:01.000Z", "tool": "runShell", "arguments_masked": {"args": ["rm -rf /"]}, "decision": "blocked", "reason": 'Blocked by policy "block-destructive-shell"', "policy_matched": "block-destructive-shell"})

        AuditTrail(directory).verify()

        with open(os.path.join(dot, "audit.json"), "r", encoding="utf-8") as handle:
            stored = json.load(handle)
        self.assertEqual(stored[0]["tool"], "runShell")
        self.assertEqual(stored[1]["previous_hash"], stored[0]["current_hash"])

    def test_sha256_hex(self):
        self.assertEqual(len(sha256("anything")), 64)
        self.assertEqual(sha256("a"), sha256("a"))


if __name__ == "__main__":
    unittest.main()