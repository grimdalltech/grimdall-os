# openai-agents adapter

Requires the `agents` package (openai-agents):

```bash
pip install "grimdall[openai-agents]"
```

`install_openai_agent_tool_guard` patches a tool's `on_invoke_tool` /
`handle_tool_call` seam so every invocation is checked before your function
runs. Blocked calls raise `GrimdallBlockedError` and are logged; approved
calls behave exactly as before.

```python
from agents import function_tool

from grimdall import Guard
from grimdall.integrations.openai_agents import install_openai_agent_tool_guard

guard = Guard()

@function_tool
def run_shell(command: str) -> str:
    """Run a shell command."""
    return f"[mock] executed: {command}"

install_openai_agent_tool_guard(run_shell, guard)

# run_shell.on_invoke_tool / handle_tool_call now enforce guardrails.
```

Wrap a `FunctionTool` (constructed from a function) the same way: pass the
tool instead of the decorated function. The adapter reads the wrapped
function's name for policy matching.

To approve or deny programmatically, inject an `approver`:

```python
guard = Guard(approver=lambda tool, record: "allow")
```

## Example

```bash
pip install "grimdall[openai-agents]"
python examples/python/openai_agents/openai_agents_example.py
```