# Grimdall Python SDK

Protect risky AI agent tool calls with Grimdall from Python, LangGraph, and custom
agent stacks.

```python
from grimdall import Grimdall

grimdall = Grimdall(endpoint="https://your-endpoint/api/execute")

grimdall.assert_allowed("github_delete_repo", {"repo_name": "myrepo"})
```

The SDK redacts common sensitive fields and sensitive-looking strings from
tool arguments before sending the policy request to Grimdall. The original
arguments are still available to your local tool handler.

## Configuration

Set these before running:

```bash
export GRIMDALL_ENDPOINT=https://your-endpoint/api/execute
export GRIMDALL_API_KEY=grimdall_sk_your_key_here
```

`GRIMDALL_ENDPOINT` is required and can also be passed to `Grimdall(endpoint=...)`.

## Guarding tools

```python
from grimdall import Grimdall

grimdall = Grimdall(endpoint="https://your-endpoint/api/execute")

@grimdall.guard_tool("github_delete_repo")
def delete_repo(arguments):
    # Call your real GitHub delete function here after Grimdall allows it.
    return {"status": "deleted"}
```

If the policy blocks the call, a `GrimdallPolicyError` is raised and the handler
never runs.
