# AutoGen adapter

Requires `autogen-core`:

```bash
pip install "grimdall[autogen]"
```

`wrap_autogen_tool` patches a `FunctionTool`-style object's `func` and
`run` entry points so every call is checked before delegation to the
original. Blocked calls raise `GrimdallBlockedError` and are logged;
allowed calls behave exactly as before.

```python
from autogen_core.tools import FunctionTool

from grimdall import Guard, Policy
from grimdall.integrations.autogen import wrap_autogen_tool

guard = Guard()
guard.add_policy(Policy(deny=["delete_repo"]))

def delete_repo(repo_name: str) -> dict:
    return {"status": "deleted", "repo": repo_name}

tool = FunctionTool(delete_repo, description="Delete a repository by name.")
wrap_autogen_tool(tool, guard)

tool.func("old-repo")  # raises GrimdallBlockedError, logged as denied
```

## Example

```bash
pip install "grimdall[autogen]"
python examples/python/autogen/autogen_example.py
```