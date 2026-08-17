"""Guard an AutoGen tool.

Requires: ``pip install "grimdall[autogen]"``

``wrap_autogen_tool`` patches a ``FunctionTool``-style object's ``func`` and
``run`` entry points so every call is checked before delegation to the
original. Blocked calls raise ``GrimdallBlockedError`` and are logged;
allowed calls behave exactly as before.
"""

from __future__ import annotations

import tempfile

from autogen_core.tools import FunctionTool

from grimdall import Guard, GrimdallBlockedError
from grimdall.integrations.autogen import wrap_autogen_tool


def delete_repo(repo_name: str) -> dict:
    """Delete a repository (in the mock, just prints)."""
    return {"status": "deleted", "repo": repo_name}


def main() -> None:
    project_dir = tempfile.mkdtemp(prefix="grimdall-autogen-")
    guard = Guard(project_dir=project_dir)

    tool = FunctionTool(delete_repo, description="Delete a repository by name.")
    wrap_autogen_tool(tool, guard)

    # Opt-in inline policy: deny this tool entirely.
    from grimdall import Policy

    guard.add_policy(Policy(deny=["delete_repo"]))

    try:
        tool.func("old-repo")
        print("[FAIL] denied call executed")
    except GrimdallBlockedError as exc:
        print("[PASS] denied call raised: {}".format(exc))
    except Exception as exc:
        print("[FAIL] unexpected error: {}".format(exc))

    guard.audit.verify()
    print("[PASS] audit chain verifies ({} entries)".format(guard.audit.entries_count()))


if __name__ == "__main__":
    main()