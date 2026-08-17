"""Guard a CrewAI tool.

Requires: ``pip install "grimdall[crewai]"``

``wrap_crewai_tool`` replaces a tool's ``_run`` and ``run`` entry points so
every call is checked before delegation to the original. Blocked calls raise
``GrimdallBlockedError`` and are logged; allowed calls behave exactly as
before.
"""

from __future__ import annotations

import tempfile

from crewai.tools import BaseTool

from grimdall import Guard, GrimdallBlockedError
from grimdall.integrations.crewai import wrap_crewai_tool


class ShellTool(BaseTool):
    """A minimal CrewAI BaseTool."""

    name: str = "runShell"
    description: str = "Runs a shell command."

    def _run(self, command: str) -> str:
        return "[mock] executed: {}".format(command)


def main() -> None:
    project_dir = tempfile.mkdtemp(prefix="grimdall-crewai-")
    guard = Guard(project_dir=project_dir)

    tool = ShellTool()
    wrap_crewai_tool(tool, guard)

    try:
        print("[PASS] allowed: {}".format(tool.run(command="ls -la")))
    except Exception as exc:
        print("[FAIL] allowed call blocked: {}".format(exc))

    try:
        tool.run(command="rm -rf /")
        print("[FAIL] blocked call executed")
    except GrimdallBlockedError as exc:
        print("[PASS] blocked call raised: {}".format(exc))
    except Exception as exc:
        print("[FAIL] unexpected error: {}".format(exc))

    guard.audit.verify()
    print("[PASS] audit chain verifies ({} entries)".format(guard.audit.entries_count()))


if __name__ == "__main__":
    main()