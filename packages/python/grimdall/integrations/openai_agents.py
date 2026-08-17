"""openai-agents SDK adapter.

Wraps the SDK's tool-invocation seam. Modern versions dispatch tool calls
through ``tool.on_invoke_tool(context, tool_call)`` (an async coroutine);
older versions used ``handle_tool_call``. This adapter patches either
method, keeping the wrapped tool's interface intact.

The SDK is never imported; the wrapper duck-types any object exposing a
``name`` and an ``on_invoke_tool``/``handle_tool_call`` coroutine.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Optional

from ..guard import BLOCKING_STATUSES, GrimdallBlockedError, Guard


def _call_name(obj: Any) -> str:
    if isinstance(obj, dict):
        return str(obj.get("name") or "unknown_tool")
    return str(getattr(obj, "name", None) or "unknown_tool")


def _call_arguments(obj: Any) -> Optional[Dict[str, Any]]:
    if isinstance(obj, dict):
        raw = obj.get("arguments", {})
    else:
        raw = getattr(obj, "arguments", None) or getattr(obj, "input", None)
    if raw is None:
        return None
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        import json

        try:
            parsed = json.loads(raw)
            return dict(parsed) if isinstance(parsed, dict) else {"args": parsed}
        except ValueError:
            return {"args": raw}
    return {"args": raw}


def install_openai_agent_tool_guard(tool: Any, guard: Guard) -> Callable[..., Awaitable[Any]]:
    """Patch ``tool.on_invoke_tool`` (or ``handle_tool_call``) with a guard.

    Blocked calls raise :class:`GrimdallBlockedError` before the inner
    executor runs. Returns the wrapper; the original is available as
    ``tool._grimdall_original``.
    """
    inner = getattr(tool, "on_invoke_tool", None) or getattr(tool, "handle_tool_call", None)
    if inner is None:
        raise TypeError(
            "Expected an openai-agents tool with on_invoke_tool or handle_tool_call; got {!r}".format(tool)
        )
    name = _call_name(tool)

    async def guarded_invoke(*args: Any, **kwargs: Any) -> Any:
        tool_call = _locate_tool_call(args)
        if tool_call is not None:
            call_name = _call_name(tool_call)
            arguments = _call_arguments(tool_call)
            guard.require_allowed(call_name or name, arguments)
        else:
            guard.require_allowed(name, _kwargs_record(args, kwargs))
        result = inner(*args, **kwargs)
        if hasattr(result, "__await__"):
            return await result
        if hasattr(result, "__aiter__"):
            items = []
            async for item in result:
                items.append(item)
            return items
        return result

    setattr(tool, "_grimdall_original", inner)
    setattr(tool, "on_invoke_tool", guarded_invoke)
    setattr(tool, "handle_tool_call", guarded_invoke)
    return guarded_invoke


def _locate_tool_call(args: tuple) -> Any:
    for value in args:
        if _looks_like_tool_call(value):
            return value
    return None


def _looks_like_tool_call(value: Any) -> bool:
    if isinstance(value, dict):
        return "arguments" in value or "name" in value
    return hasattr(value, "arguments") or hasattr(value, "name")


def _kwargs_record(args: tuple, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    if kwargs:
        return dict(kwargs)
    if len(args) == 1 and isinstance(args[0], dict):
        return dict(args[0])
    return {"args": list(args)}