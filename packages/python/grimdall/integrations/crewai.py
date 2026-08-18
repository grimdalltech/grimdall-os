"""CrewAI adapter.

CrewAI tools execute through ``Tool.run`` which delegates to the tool's
``_run`` implementation. This adapter patches ``tool._run`` (falling back
to ``tool.run``) so every execution is guarded before the inner handler
runs.

The framework is never imported; any object exposing ``name`` and
``_run``/``run`` is duck-typed.
"""

from __future__ import annotations

import functools
from typing import Any, Callable, Dict

from ..guard import BLOCKING_STATUSES, GrimdallBlockedError, Guard


def wrap_crewai_tool(tool: Any, guard: Guard) -> Callable[..., Any]:
    """Patch ``tool._run`` with a guard; returns the wrapper."""
    inner = getattr(tool, "_run", None) or getattr(tool, "run", None)
    if inner is None:
        raise TypeError(
            "Expected a CrewAI tool with _run (or run); got {!r}".format(tool)
        )
    name = getattr(tool, "name", None) or tool.__class__.__name__

    def guarded_run(*args: Any, **kwargs: Any) -> Any:
        record = dict(kwargs) if kwargs else _positional_record(args)
        guard.require_allowed(str(name), record)
        return inner(*args, **kwargs)

    @functools.wraps(inner)
    async def guarded_run_async(*args: Any, **kwargs: Any) -> Any:
        record = dict(kwargs) if kwargs else _positional_record(args)
        guard.require_allowed(str(name), record)
        result = inner(*args, **kwargs)
        if hasattr(result, "__await__"):
            return await result
        return result

    import inspect as _inspect

    wrapper = guarded_run_async if _inspect.iscoroutinefunction(inner) else guarded_run
    setattr(tool, "_grimdall_original", inner)
    setattr(tool, "_run", wrapper)
    setattr(tool, "run", wrapper)
    return wrapper


def _positional_record(args: tuple) -> Dict[str, Any]:
    if len(args) == 1 and isinstance(args[0], dict):
        return dict(args[0])
    return {"args": list(args)}