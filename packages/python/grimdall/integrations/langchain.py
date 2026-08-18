"""LangChain adapter.

Two integration points:

1. ``GrimdallCallbackHandler`` - a callback handler enforcing on
   ``on_tool_start``. When ``langchain-core`` is installed the handler
   subclasses its ``BaseCallbackHandler``; otherwise it exposes the same
   method on a plain object, so the same code works in dependency-free
   test harnesses.
2. ``wrap_langchain_tool`` - wraps a tool object (anything exposing
   ``name`` and ``run``) so every invocation is guarded.

Blocked calls raise a ``ToolExecutionError`` when ``langchain-core`` is
available, otherwise ``GrimdallBlockedError``.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..guard import BLOCKING_STATUSES, GrimdallBlockedError, Guard


class _FallbackToolExecutionError(Exception):
    """Raised when langchain-core is not installed; same shape as ToolExecutionError."""

    def __init__(self, message: str, *, tool_name: Optional[str] = None) -> None:
        super().__init__(message)
        self.tool_name = tool_name


_BaseHandler: Any = None
_ToolExecutionError: Any = _FallbackToolExecutionError
try:  # optional, never required
    from langchain_core.callbacks.base import BaseCallbackHandler  # type: ignore
    from langchain_core.exceptions import ToolExecutionError  # type: ignore

    _BaseHandler = BaseCallbackHandler
    _ToolExecutionError = ToolExecutionError
except Exception:  # pragma: no cover - depends on optional framework
    pass

if _BaseHandler is not None:

    class _HandlerBase(_BaseHandler):  # type: ignore[misc, valid-type]
        pass

else:

    class _HandlerBase:
        pass


def _extract_tool_input(
    args: tuple, kwargs: Dict[str, Any]
) -> tuple[Optional[str], Optional[Dict[str, Any]]]:
    """Normalize both legacy and current on_tool_start callback shapes.

    Legacy: ``on_tool_start(serialized: dict, input_str: str, *, inputs=...)``
    Current: ``on_tool_start(run_id, tool, input, **kwargs)``.
    Inspects ``kwargs`` before positional arguments so named-parameter
    callback styles resolve too.
    """
    if "tool" in kwargs:
        tool = kwargs.get("tool")
        raw = kwargs.get("input") or kwargs.get("inputs")
        return _as_record(tool, raw)

    if not args:
        return None, None

    first = args[0]
    if isinstance(first, dict):
        # legacy serialized dict
        raw = kwargs.get("inputs") or first.get("input") or first.get("args")
        if raw is None and len(args) >= 2:
            raw = args[1]
        return _as_record(first.get("name"), raw)

    if len(args) >= 3:
        # current API: (run_id, tool, input)
        tool = getattr(args[1], "name", None) or args[1]
        return _as_record(tool, args[2])

    tool = getattr(first, "name", None) or first
    raw = kwargs.get("inputs") or getattr(first, "input", None)
    return _as_record(tool, raw)


def _as_record(tool: Any, raw: Any) -> tuple[Optional[str], Optional[Dict[str, Any]]]:
    if raw is None:
        return str(tool) if tool is not None else None, None
    if isinstance(raw, dict):
        return str(tool) if tool is not None else None, dict(raw)
    return str(tool) if tool is not None else None, {"args": raw}


class GrimdallCallbackHandler(_HandlerBase):
    """Guard tool calls at the ``on_tool_start`` callback boundary."""

    def __init__(self, guard: Guard, *, raise_on_block: bool = True) -> None:
        super().__init__()
        self.guard = guard
        self.raise_on_block = raise_on_block

    def on_tool_start(self, *args: Any, **kwargs: Any) -> None:
        tool, tool_input = _extract_tool_input(args, kwargs)
        if tool is None:
            return
        decision = self.guard.check(str(tool), tool_input)
        if decision["status"] in BLOCKING_STATUSES and self.raise_on_block:
            raise _ToolExecutionError(
                "[BLOCKED] " + (decision.get("reason") or 'Tool "{}" blocked'.format(tool)),
                tool_name=str(tool),
            )

    def check(self, tool: str, tool_input: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self.guard.check(tool, tool_input)


def wrap_langchain_tool(tool: Any, guard: Guard) -> Any:
    """Return a guard-wrapped callable for a tool exposing ``name``/``run``."""
    name = getattr(tool, "name", None) or tool.__class__.__name__
    run = getattr(tool, "run")
    import functools

    @functools.wraps(run)
    def guarded_run(*args: Any, **kwargs: Any) -> Any:
        if len(args) == 1 and isinstance(args[0], dict) and not kwargs:
            record = dict(args[0])
        elif kwargs:
            record = dict(kwargs)
        else:
            record = {"args": list(args)}
        guard.require_allowed(str(name), record)
        return run(*args, **kwargs)

    return guarded_run