"""Local verification script for the grimdall Python SDK.

Run from any fresh environment after ``pip install grimdall``:

    python verify_langchain.py [project_dir]

It exercises the LangChain-style integration surface without needing
langchain installed (the handler and tool shapes are duck-typed):

1. Allowed tool calls execute.
2. Destructive tool calls are blocked (``GrimdallBlockedError``) and logged.
3. Approval-required tools deny on timeout (never fail open).
4. The tamper-evident audit chain verifies after all of the above.
5. Exit code 0 means every check passed.

Requires only the standard library and ``grimdall``.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from grimdall import AuditTrail, Guard, Policy
from grimdall.integrations.langchain import GrimdallCallbackHandler, wrap_langchain_tool


class DummyShellTool:
    """A LangChain-style tool: ``name`` plus a ``run`` method."""

    name = "runShell"

    def run(self, command: str) -> str:
        return "[mock] executed: {}".format(command)


def main() -> int:
    if len(sys.argv) > 1:
        project_dir = Path(sys.argv[1]).resolve()
    else:
        project_dir = Path(tempfile.mkdtemp(prefix="grimdall-verify-"))
    project_dir.mkdir(parents=True, exist_ok=True)
    os.chdir(project_dir)
    print("project dir: {}".format(project_dir))

    failures = []
    guard = Guard(project_dir=str(project_dir), approval_timeout_seconds=5)
    handler = GrimdallCallbackHandler(guard)

    def expect(label: str, condition: bool) -> None:
        print("[{}] {}".format("PASS" if condition else "FAIL", label))
        if not condition:
            failures.append(label)

    # 1. Allowed calls execute; wrapped tool preserves behavior.
    wrapped = wrap_langchain_tool(DummyShellTool(), guard)
    result = wrapped("ls -la")
    expect("allowed tool call executes", result == "[mock] executed: ls -la")

    # 2. Destructive calls raise and are logged as blocked.
    blocked = False
    try:
        wrapped("rm -rf /")
    except Exception as exc:
        blocked = "[BLOCKED]" in str(exc)
        print("  blocked error: {}".format(exc))
    expect("destructive call raises [BLOCKED]", blocked)
    expect(
        "blocked call logged in audit",
        any(entry["decision"] == "blocked" for entry in guard.audit.get_entries()),
    )

    # 2b. The callback-handler seam blocks the same way.
    handler_blocked = False
    try:
        handler.on_tool_start({"name": "runShell"}, "rm -rf /")
    except Exception as exc:
        handler_blocked = "[BLOCKED]" in str(exc)
        print("  handler blocked error: {}".format(exc))
    expect("callback handler blocks destructive calls", handler_blocked)

    # 3. Approvals deny on timeout: never fail open.
    guard.add_policy(Policy(require_approval=["deploy_production"]))
    deploy = guard.wrap(tool="deploy_production")(lambda target: "deployed to " + str(target))
    timed_out = False
    try:
        deploy("example.com")
    except Exception as exc:
        timed_out = "approval" in str(exc).lower() or "rejected" in str(exc).lower()
        print("  approval error: {}".format(exc))
    expect("approval timeout denies instead of failing open", timed_out)
    expect(
        "approval timeout logged",
        any(entry["decision"] == "approval_timed_out" for entry in guard.audit.get_entries()),
    )

    # 4. Audit chain verifies end to end.
    try:
        AuditTrail(project_dir).verify()
        trace_ok = True
    except Exception as exc:
        trace_ok = False
        print("  verify error: {}".format(exc))
    expect("audit chain verifies", trace_ok)

    print()
    if failures:
        print("VERIFY FAILED: {}".format("; ".join(failures)))
        return 1
    print("VERIFY PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())