"""AutoGen (autogen-agentchat) adapter.

AutoGen's ``FunctionTool``/``Tool`` objects carry a plain ``func`` that the
runtime invokes from ``execute_tool_call``. This adapter patches
``tool.func`` (or ``tool.run`` when ``func`` is absent) so every execution
is guarded before the inner function runs.

The framework is never imported; any object exposing ``name`` and
``func``/``run`` is duck-typed.
"""

from __future__ import annotations

import functools
import inspect
from typing import Any, Callable, Dict, Optional

from ..guard import BLOCKING_STATUSES, GrimdallBlockedError, Guard


def wrap_autogen_tool(tool: Any, guard: Guard) -> Callable[..., Any]:
    """Patch ``tool.func`` with a guard; returns the wrapper."""
    inner: Optional[Callable[..., Any]] = getattr(tool, "func", None) or getattr(tool, "run", None)
    if inner is None:
        raise TypeError("Expected an AutoGen tool with func (or run); got {!r}".format(tool))
    name = getattr(tool, "name", None) or getattr(inner, "__name__", "unknown_tool")

    @functools.wraps(inner)
    def guarded(*args: Any, **kwargs: Any) -> Any:
        record = dict(kwargs) if kwargs else _positional_record(args)
        guard.require_allowed(str(name), record)
        return inner(*args, **kwargs)

    @functools.wraps(inner)
    async def guarded_async(*args: Any, **kwargs: Any) -> Any:
        record = dict(kwargs) if kwargs else _positional_record(args)
        guard.require_allowed(str(name), record)
        result = inner(*args, **kwargs)
        if hasattr(result, "__await__"):
            return await result
        return result

    wrapper = guarded_async if inspect.iscoroutinefunction(inner) else guarded
    setattr(tool, "_grimdall_original", inner)
    setattr(tool, "func", wrapper)
    setattr(tool, "run", wrapper)
    return wrapper


def _positional_record(args: tuple) -> Dict[str, Any]:
    if len(args) == 1 and isinstance(args[0], dict):
        return dict(args[0])
    return {"args": list(args)}