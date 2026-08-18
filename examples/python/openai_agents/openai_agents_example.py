"""Guard an openai-agents function tool.

Requires: ``pip install "grimdall[openai-agents]"``

``install_openai_agent_tool_guard`` patches a tool's ``on_invoke_tool`` /
``handle_tool_call`` seam so every invocation is checked before the wrapped
function runs. Blocked calls raise ``GrimdallBlockedError`` and are logged;
approved calls behave exactly as before.
"""

from __future__ import annotations

import asyncio
import tempfile

from agents import function_tool

from grimdall import Guard, GrimdallBlockedError
from grimdall.integrations.openai_agents import install_openai_agent_tool_guard


@function_tool
def run_shell(command: str) -> str:
    """Run a shell command."""
    return "[mock] executed: {}".format(command)


def tool_call(name: str, arguments: dict):
    """Shim for the tool-call object the agent loop passes to the seam:
    anything exposing ``name`` and ``arguments`` attributes."""
    from types import SimpleNamespace

    return SimpleNamespace(name=name, arguments=arguments)


async def main() -> None:
    project_dir = tempfile.mkdtemp(prefix="grimdall-openai-agents-")
    guard = Guard(project_dir=project_dir)

    install_openai_agent_tool_guard(run_shell, guard)

    try:
        await run_shell.on_invoke_tool(None, tool_call(run_shell.name, {"command": "ls -la"}))
        print("[PASS] allowed tool call ran")
    except Exception as exc:
        print("[FAIL] allowed call blocked: {}".format(exc))

    try:
        await run_shell.on_invoke_tool(None, tool_call(run_shell.name, {"command": "rm -rf /"}))
        print("[FAIL] blocked call executed")
    except GrimdallBlockedError as exc:
        print("[PASS] blocked call raised: {}".format(exc))
    except Exception as exc:
        print("[FAIL] unexpected error: {}".format(exc))

    guard.audit.verify()
    print("[PASS] audit chain verifies ({} entries)".format(guard.audit.entries_count()))


if __name__ == "__main__":
    asyncio.run(main())