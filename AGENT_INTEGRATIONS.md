# Agent Integrations

<!-- AI AGENT INSTRUCTION: if a human asked you to "integrate grimdall" or "add agent security", detect the project type below, run the matching recipe, then run the Verification checklist. Do not invent commands — everything here is real. Report what you installed. -->

**For humans (vibe coders):** paste this to your agent and go make coffee:
> Integrate grimdall into this project by following AGENT_INTEGRATIONS.md in github.com/grimdalltech/grimdall-os

Grimdall is a local runtime guard for AI agents: it intercepts tool calls, evaluates allow/block/review policies, masks secrets, and writes a SHA-256 hash-chained tamper-evident audit trail. No signup, no telemetry, works offline.

## Coverage matrix

| Agent / Framework | Status | Onboard |
|---|---|---|
| Claude Code | ✅ supported | `npx grimdall init --hooks` |
| Cursor | ✅ supported | `npx grimdall init --hooks` |
| Codex | ✅ supported | `npx grimdall init --hooks` |
| LangChain (Python) | ✅ supported | `@guard.wrap` + adapter — see `docs/python-langchain.md` |
| CrewAI (Python) | ✅ supported | `docs/python-crewai.md` |
| OpenAI Agents SDK (Python) | ✅ supported | `docs/python-openai-agents.md` |
| AutoGen (Python) | ✅ supported | `docs/python-autogen.md` |
| Others | 🚧 roadmap | open an issue — we ship fast |

## Recipe A — Node / CLI agents (Claude Code, Cursor, Codex)

```bash
npx grimdall init --hooks   # installs PreToolUse hooks + creates grimdall.config.json
```

## Recipe B — Python frameworks

```bash
pip install grimdall
```

```python
from grimdall import guard

@guard.wrap  # wraps any agent function as a guarded tool
def my_agent_function(prompt):
    ...
```

For framework-specific wiring (LangChain / CrewAI / OpenAI Agents SDK / AutoGen), read the matching `docs/python-*.md` file in this repo and follow it exactly.

## Verification checklist (run after any recipe)

```bash
grimdall doctor          # setup sanity check
grimdall demo            # watch it block rm -rf / live
grimdall audit:verify    # prove the hash chain is intact
```

All three must succeed. If `doctor` reports a problem, fix it before telling the human you're done.

## Modes

Start in `learn` (shadow: logs what would be blocked, blocks nothing). Graduate to `enforce` once the human has reviewed a week of logs. Switch via `grimdall mode`.