# Grimdall for Python

**One decorator. Any framework. Zero infra.**

Grimdall is a local-only runtime security layer for AI agents. One import
guards tool calls in any agent framework, with no proxy, no Docker, no
signup, and no network calls. Policies, rate limits, budgets, approvals,
and a tamper-evident audit trail live in your project's `.grimdall/`
directory and interoperate with the Grimdall CLI hooks and Node SDK on the
same hash-chained `audit.json`.

## Install

```bash
pip install grimdall
```

No dependencies beyond the Python standard library. Works offline, forever,
for $0/month.

## One decorator

```python
from grimdall import Guard

guard = Guard()  # zero-config: reads .grimdall/ policies, appends the local audit chain

@guard.wrap
def run_shell(command: str) -> str:
    return f"[mock] executed: {command}"

run_shell("ls -la")   # allowed, logged as "allowed"
run_shell("rm -rf /") # raises GrimdallBlockedError, logged as "blocked"
```

Every decision is appended to the same SHA-256 hash-chained audit file as
CLI-hook events, so a single `audit.json` can be verified end to end:

```python
from grimdall import AuditTrail

AuditTrail(".grimdall").verify()  # raises AuditError on any tampering
```

## Inline guardrails

```python
from grimdall import Guard, Policy

guard = Guard()
guard.add_policy(
    Policy(
        deny=["github_delete_repo"],
        rate_limit={"max": 10, "per": "minute"},
        budget={"max_spend": 50.0, "period": "day"},
        require_approval=["deploy_production"],
    )
)
```

Evaluation order: identity/credential -> policy rules -> rate limits ->
budget -> approval -> execute. Approval tools prompt in your terminal
(`[Allow/Deny/Allow 1h]`) and a timeout or a missing TTY denies the call:
approvals never fail open.

## Any framework

```python
from grimdall import Guard
from grimdall.integrations.langchain import GrimdallCallbackHandler

handler = GrimdallCallbackHandler(Guard())
```

Adapters ship for LangChain, openai-agents, CrewAI, and AutoGen under
`grimdall.integrations.*`. Each is a thin shim over the same core Guard and
never forces the framework to be installed.

## Audit mode

When `.grimdall/config.json` sets `"mode": "audit"` (the CLI default),
blocked decisions are recorded as `would_block` and the call proceeds. Run
`npx grimdall mode enforce` to switch to hard enforcement.

## Project layout

```text
.grimdall/  (created for you)
├── policies.json   # default policies (CLI-compatible)
├── config.json     # mode + optional Slack webhook
├── audit.json      # tamper-evident hash chain
└── spend.json      # budget ledger
```
