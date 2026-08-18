"""Framework adapter tests using duck-typed fakes (no framework installed).

Each fake reproduces the integration seam the real framework exposes:

- langchain: callback via ``on_tool_start`` and tools via ``name``/``run``
- openai-agents: ``on_invoke_tool(context, tool_call)`` coroutine seam
- crewai: ``tool._run`` / ``tool.run`` execution
- autogen: ``tool.func`` execution
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from contextlib import contextmanager

from grimdall import Guard, GrimdallBlockedError, Policy
from grimdall.integrations.autogen import wrap_autogen_tool
from grimdall.integrations.crewai import wrap_crewai_tool
from grimdall.integrations.langchain import GrimdallCallbackHandler, wrap_langchain_tool
from grimdall.integrations.openai_agents import install_openai_agent_tool_guard


@contextmanager
def project_dir():
    directory = tempfile.mkdtemp(prefix="grimdall-adapters-")
    original = os.getcwd()
    os.chdir(directory)
    try:
        yield directory
    finally:
        os.chdir(original)


class FakeToolCall:
    def __init__(self, name: str, arguments: dict):
        self.name = name
        self.arguments = arguments


class FakeOpenAITool:
    def __init__(self, name: str):
        self.name = name
        self.calls = []

    async def on_invoke_tool(self, context, tool_call):
        self.calls.append(tool_call)
        return {"status": "ok"}


class FakeCrewAITool:
    def __init__(self, name: str):
        self.name = name
        self.calls = []

    def _run(self, **kwargs):
        self.calls.append(kwargs)
        return "ran"


class FakeAutoGenTool:
    def __init__(self, name: str, func):
        self.name = name
        self.func = func


class LangChainAdapterTest(unittest.TestCase):
    def test_callback_handler_blocks_destructive_tool(self):
        with project_dir():
            guard = Guard()
            handler = GrimdallCallbackHandler(guard)
            with self.assertRaises(Exception) as raised:
                handler.on_tool_start({"name": "runShell"}, "rm -rf /")
            self.assertIn("[BLOCKED]", str(raised.exception))
            entry = guard.audit.get_entries()[-1]
            self.assertEqual(entry["decision"], "blocked")

    def test_callback_handler_current_api_shape(self):
        with project_dir():
            guard = Guard()
            handler = GrimdallCallbackHandler(guard)

            class Tool:
                name = "runShell"

            with self.assertRaises(Exception):
                handler.on_tool_start("run-id-1", Tool(), {"input": "rm -rf /"})
            self.assertEqual(guard.audit.get_entries()[-1]["decision"], "blocked")
            handler.on_tool_start("run-id-2", Tool(), {"command": "ls -la"})

    def test_wrap_langchain_tool_guards_runs(self):
        with project_dir():
            guard = Guard()

            class ShellTool:
                name = "runShell"

                def run(self, cmd: str) -> str:
                    return "[mock] executed: {}".format(cmd)

            guarded = wrap_langchain_tool(ShellTool(), guard)
            self.assertEqual(guarded("ls -la"), "[mock] executed: ls -la")
            with self.assertRaises(GrimdallBlockedError):
                guarded("rm -rf /")


class OpenAIAdaptersTest(unittest.TestCase):
    def test_openai_agents_tool_guard_blocks(self):
        with project_dir():
            guard = Guard()
            tool = FakeOpenAITool("runShell")
            install_openai_agent_tool_guard(tool, guard)

            async def scenario() -> None:
                with self.assertRaises(GrimdallBlockedError):
                    await tool.on_invoke_tool(None, FakeToolCall("runShell", {"cmd": "rm -rf /"}))
                self.assertEqual(len(tool.calls), 0)
                result = await tool.on_invoke_tool(None, FakeToolCall("runShell", {"cmd": "ls -la"}))
                self.assertEqual(result, {"status": "ok"})
                self.assertEqual(len(tool.calls), 1)

            asyncio.run(scenario())
            entries = guard.audit.get_entries()
            self.assertEqual(entries[0]["decision"], "blocked")
            self.assertEqual(entries[1]["decision"], "allowed")


class CrewAIAdapterTest(unittest.TestCase):
    def test_crewai_tool_guard_blocks(self):
        with project_dir():
            guard = Guard()
            tool = FakeCrewAITool("runShell")
            wrap_crewai_tool(tool, guard)
            self.assertEqual(tool.run(cmd="ls -la"), "ran")
            with self.assertRaises(GrimdallBlockedError):
                tool.run(cmd="rm -rf /")
            self.assertEqual(tool.calls, [{"cmd": "ls -la"}])


class AutoGenAdapterTest(unittest.TestCase):
    def test_autogen_tool_guard_blocks(self):
        with project_dir():
            guard = Guard()

            def delete_repo(repo_name: str) -> dict:
                return {"status": "deleted"}

            tool = FakeAutoGenTool("delete_repo", delete_repo)
            wrap_autogen_tool(tool, guard)
            guard.add_policy(Policy(deny=["delete_repo"]))
            with self.assertRaises(GrimdallBlockedError):
                tool.func("myrepo")
            self.assertEqual(guard.audit.get_entries()[-1]["decision"], "denied")


if __name__ == "__main__":
    unittest.main()