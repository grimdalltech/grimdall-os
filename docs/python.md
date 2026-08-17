# Python SDK

One decorator. Any framework. Zero infra.

The `grimdall` Python package wraps any tool call with runtime guardrails,
entirely on your machine. No signup, no proxy, no telemetry, no network
dependency. Every decision is appended to the same tamper-evident,
SHA-256 hash-chained audit trail that the Node.js SDK and the CLI hooks
write, so one `.grimdall/audit.json` is shared across your whole stack.

## Install

```bash
pip install grimdall
```

Optional framework adapters:

```bash
pip install "grimdall[langchain]"      # LangChain callback handler + tool wrapper
pip install "grimdall[openai-agents]"  # openai-agents function tool guard
pip install "grimdall[crewai]"         # CrewAI BaseTool guard
pip install "grimdall[autogen]"        # AutoGen FunctionTool guard
pip install "grimdall[all]"            # everything above
```

The core library is pure standard library (Python 3.9+). Adapters never
import their framework at module load time.

## One-liner quick start

```python
from grimdall import Guard, Policy, AuditTrail

guard = Guard()  # creates .grimdall/ if missing
guard.add_policy(Policy(deny=["delete_repo"]))

@guard.wrap
def run_shell(command: str) -> str:
    return f"[mock] executed: {command}"

run_shell("ls -la")     # runs
run_shell("rm -rf /")   # raises GrimdallBlockedError
```

That is the whole integration. Destructive input, secrets, rate limits,
budgets, approvals, and the audit trail are handled for you.

## How it works

`Guard.wrap` works on sync and async functions. Each call runs the full
guardrail pipeline before executing:

```text
identity/credential -> policy rules -> rate limits -> budget -> approval -> execute
```

- **Injection scan** mirrors the CLI hook runner: shell-destructive,
  SQL-destructive, and path-traversal patterns are weighted and risk above
  75 blocks outright.
- **File policies** from `.grimdall/policies.json` (defaults are generated
  on first run) apply `allow`, `block`, and `review` rules.
- **Secrets** are masked before anything is logged: `sk-*` keys, `AKIA*`
  AWS keys, `gh[pousr]_*` tokens, and `Bearer` tokens.
- Every decision is appended to `.grimdall/audit.json` with a hash chain
  identical to the CLI hook format. `Guard.spend(tool, amount)` meters and
  logs spend against `.grimdall/spend.json`.

## Inline policies

```python
guard.add_policy(
    Policy(
        deny=["github_delete_repo"],
        rate_limit={"max": 10, "per": "minute"},          # or {"seconds": 5}
        budget={"max_spend": 50.0, "period": "day"},      # day | week | month | total
        require_approval=["deploy_production"],
    )
)
```

`rate_limit` and `budget` accept an optional `"tool"` key to scope them to
one tool. `require_approval` also accepts `"*"`.

### Approvals never fail open

Tools on the `require_approval` list prompt in the local terminal:

```text
[GRIMDALL] Approve tool "deploy_production" (...)? [Allow/Deny/Allow 1h] (120s):
```

`Allow` approves this call, `Deny` blocks it, and `Allow 1h` caches the
approval for the tool for one hour. If the prompt times out or there is no
TTY, the call is **denied** (`approval_timed_out`). There is no path where
an unattended approval turns into an execution.

For tests or non-interactive callers, inject an `approver`:

```python
guard = Guard(approver=lambda tool, record: "deny")
```

## Identity and credentials

Restrict a tool to specific users, roles, or an env-var credential:

```python
guard.restrict("delete_repo", users=["ci-bot"], credential="GITHUB_TOKEN")
```

Pass evidence in the call record:

```python
@guard.wrap(tool="delete_repo")
def delete_repo(repo: str) -> dict:
    ...
    return {"ok": True}

delete_repo({"repo": "old-repo", "identity": {"user": "ci-bot", "roles": ["release"]}})
```

The `identity` field can be a string (treated as the user) or a dict with
`user` and `roles`. Bound tools call `require_allowed`, which raises
`GrimdallBlockedError` on any blocking decision.

## Audit mode

Read the mode from `.grimdall/config.json`. In `audit` mode, blocking
decisions (except approvals) are downgraded to `would_block` and the call
proceeds. Switch back to hard enforcement with:

```json
{ "version": 1, "mode": "enforce" }
```

## Spending and budgets

A tool call with a `cost` key in its record is metered automatically:

```python
@guard.wrap
def run_heavy_job(...) -> str:
    return result

run_heavy_job({"cost": 12.5, ...})  # recorded as spend 12.5
```

Manual metering:

```python
guard.spend("run_heavy_job", 12.5)
```

The ledger lives in `.grimdall/spend.json`; every spend is also appended
to the audit chain as a `spend` decision. A `budget` policy blocks calls
that would exceed `max_spend` over the period.

## Audit verification

Every entry is chained via `sha256(compactJson(entry) + previousHash)`
with the first entry anchored to `GENESIS`, byte-compatible with the
Node.js SDK and CLI hooks. Verify the whole chain:

```python
from grimdall import AuditTrail

AuditTrail(".").verify()  # raises AuditError on tampering
```

## Framework adapters

| Adapter             | Integration point                                        |
| ------------------- | -------------------------------------------------------- |
| LangChain           | `GrimdallCallbackHandler` + `wrap_langchain_tool`        |
| openai-agents       | `install_openai_agent_tool_guard`                        |
| CrewAI              | `wrap_crewai_tool`                                       |
| AutoGen             | `wrap_autogen_tool`                                      |

Details on each:

- [LangChain](python-langchain.md)
- [openai-agents](python-openai-agents.md)
- [CrewAI](python-crewai.md)
- [AutoGen](python-autogen.md)

Runnable examples live in `examples/python/`. The LangChain example is the
canonical smoke test:

```bash
pip install grimdall
python examples/python/langchain/verify_langchain.py
```

It prints `VERIFY PASSED` when allowed calls run, destructive calls are
blocked and logged, approval timeouts deny, and the audit chain verifies.