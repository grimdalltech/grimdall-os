# LangChain adapter

Requires `langchain-core`:

```bash
pip install "grimdall[langchain]"
```

Two integration points. The callback handler enforces at the
`on_tool_start` callback boundary; the tool wrapper guards a tool directly.

## Callback handler

Attach `GrimdallCallbackHandler` to your chain. Every tool call that would
be blocked raises (by default) and is logged:

```python
from langchain.agents import create_react_agent
from langchain_core.callbacks import CallbackManager

from grimdall import Guard
from grimdall.integrations.langchain import GrimdallCallbackHandler

guard = Guard()
handler = GrimdallCallbackHandler(guard, raise_on_block=False)

agent = create_react_agent(
    ...,
    callbacks=[handler],
)
```

With `raise_on_block=True` (default) a blocked call raises a
`ToolExecutionError` whose message starts with `[BLOCKED]`. The handler can
also be used directly:

```python
handler.on_tool_start({"name": "runShell"}, "rm -rf /")  # legacy shape
handler.on_tool_start("run-1", tool, {"command": "rm -rf /"})  # current shape
```

Both legacy and current `on_tool_start` shapes are normalized.

## Tool wrapper

Wrap a tool (anything with `name` and `run`, such as `StructuredTool`)
so every invocation is guarded:

```python
from langchain.tools import tool as lc_tool

from grimdall import Guard
from grimdall.integrations.langchain import wrap_langchain_tool

guard = Guard()

@lc_tool
def runShell(command: str) -> str:
    """Run a shell command."""
    return f"[mock] executed: {command}"

guarded = wrap_langchain_tool(runShell, guard)

guarded("ls -la")    # runs
guarded("rm -rf /")  # raises GrimdallBlockedError, logged as blocked
```

## Example

```bash
pip install "grimdall[langchain]"
python examples/python/langchain/verify_langchain.py
```

See `examples/python/langchain/verify_langchain.py` for the full smoke
test. It passes without `langchain` installed, since both the handler and
the tool shape are exercised through duck-typed seams.