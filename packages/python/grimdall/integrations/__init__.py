"""Framework adapters for Grimdall.

Each adapter is a thin shim over the core :class:`grimdall.guard.Guard`.
Adapters never import the framework package at module load time, so
``pip install grimdall`` stays dependency-free; the shims duck-type the
framework's integration points and work whether or not the framework is
installed.

- ``langchain`` - a callback handler enforcing on ``on_tool_start`` and a
  ``wrap_langchain_tool`` wrapper for tool objects with ``name``/``run``.
- ``openai_agents`` - an interceptor for the openai-agents SDK's
  ``on_invoke_tool`` seam.
- ``crewai`` - a wrapper for CrewAI tool ``_run`` execution.
- ``autogen`` - a hook for AutoGen ``FunctionTool`` execution.
"""
