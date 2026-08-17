<div align="center">
<img src="assets/grimdall-banner.png" 
alt="Grimdall — runtime security for AI agents" width="75%" />

Runtime security for AI agents. Stops the tool calls that would delete your repo, nuke your shell, or leak your keys, then writes a tamper-evident, SHA-256 hash-chained audit trail you can verify with one command. Runs fully local: no signup, no telemetry, no API key.

[![ci](https://github.com/grimdalltech/grimdall-os/actions/workflows/ci.yml/badge.svg)](https://github.com/grimdalltech/grimdall-os/actions/workflows/ci.yml)

## Features

- **Policy enforcement** - Declarative policies (`allow`, `block`, `review`) matched against every tool call, with wildcard tool matching and argument-based conditions.
- **Secret masking** - Deep-clones call arguments and redacts OpenAI keys, AWS access keys, GitHub tokens, and bearer tokens before anything is written to the audit log.
- **Injection detection** - Flags shell-destructive, SQL-destructive, and path-traversal patterns with a weighted risk score. Calls above the risk threshold are blocked outright.
- **Human-in-the-loop Slack alerts** - Blocked calls can emit a real-time Slack webhook alert so teams can review dangerous actions immediately.
- **Tamper-evident audit trail** - Every audit entry is chained to the previous entry via SHA-256. Any modification, reordering, or deletion is detected on verification.
- **Node.js SDK** - Wrap any function as a secured tool in one line.
- **Python SDK** - One decorator. Any framework. Zero infra. Pure stdlib core plus optional LangChain, openai-agents, CrewAI, and AutoGen adapters.
- **CLI** - Initialize configs, verify audit integrity, and view the audit log as a table.

## Repository layout

```text
grimdall/
├── packages/
│   ├── core/     (grimdall-core) - Policy engine, masking, detection, audit trail
│   ├── node/     (grimdall-node) - SDK for Node.js/TypeScript applications
│   ├── cli/      (grimdall)      - Command line tool
│   └── python/   (grimdall)       - Python SDK: guard decorator + framework adapters
├── examples/     - Runnable examples (node and python)
├── docs/         - Markdown documentation
└── README.md
```

## Installation

Requires Node.js 18 or newer.

```bash
cd grimdall
npm install
npm run build
```

### Python SDK

Requires Python 3.9 or newer; the core is pure standard library.

```bash
pip install grimdall
```

Note: the PyPI build (0.1.0) is a stub pending republish. Until it lands, install from source with `pip install -e ./packages/python`.

Optional adapters: `grimdall[langchain]`, `grimdall[openai-agents]`,
`grimdall[crewai]`, `grimdall[autogen]`. See [docs/python.md](docs/python.md).

## Try it in 5 minutes

**One command. No signup. No API key. No telemetry. Runs fully on your machine.**

### 1. Install the guard

```bash
npx grimdall init --hooks
```

That one command writes `.grimdall/` with the config, six default policies, and an empty audit trail, then installs PreToolUse hooks for any Claude Code, Cursor, or Codex config it finds. Agents that are not installed are skipped with a message, never an error. Hooks start in `audit` mode (learn-only): blocked calls are recorded as `would_block` and allowed to proceed. Switch to hard enforcement with `grimdall mode enforce`.

### 2. See it work

```bash
npx grimdall demo
```

Ten seconds, zero config: one allowed call, one blocked call (`rm -rf /` never reaches a shell), and one masked secret. Every decision lands in the SHA-256 hash-chained `.grimdall/audit.json`.

### 3. Verify the trail

```bash
grimdall audit:verify
```

Expected output:

```text
[SUCCESS] Audit Verified (4 entries, hash chain intact)
```

Edit any entry in `audit.json` and verification fails with exit code 1, ready for CI. The published npm build is a version behind this repo: `audit:verify`, `audit:view`, `mode`, and the workspace commands land there with the next publish. Coming soon.

### 4. Python: one decorator

Install from source until the PyPI republish lands (the current PyPI `grimdall` is a stub):

```bash
pip install -e ./packages/python
```

```python
from grimdall import Guard, Policy

guard = Guard()
guard.add_policy(Policy(deny=["delete_repo"]))

@guard.wrap
def delete_repo(repo: str) -> str:
    return f"[mock] deleted {repo}"

delete_repo("acme/web")  # raises GrimdallBlockedError
```

Every decision lands in the same hash-chained audit file the CLI writes, so one `audit:verify` covers hooks, the Node SDK, and Python. Framework adapters for LangChain, openai-agents, CrewAI, and AutoGen live under `grimdall.integrations.*`. Runnable examples live in `examples/`: `node-basic`, `python-basic`, and `cli-demo`, each with its own README.

## Audit Verification

The audit trail is a hash chain. Each entry stores the hash of the previous entry and a SHA-256 of its own contents plus the previous hash. The first entry anchors to the literal hash `GENESIS`.

Verify the trail:

```bash
node packages/cli/bin/grimdall.js audit:verify
# [SUCCESS] Audit Verified (2 entries, hash chain intact)
```

Tamper with the log and verify again:

```bash
node packages/cli/bin/grimdall.js audit:view
```

Any edit to a logged decision, arguments, hash, or entry ordering causes verification to fail:

```text
[ERROR] Tampering Detected: Hash mismatch at entry "..." : tampering detected
```

The verification command exits with code 1 when tampering is detected, so it can be wired into CI.

## Proof

Real output, captured from the shipped CLI, no edits:

```text
[DEMO] Starting Grimdall zero-config demo...

[DEMO] Created Grimdall instance with zero-config (auto-created .grimdall/)

[DEMO] Running allowed call: runShell("ls -la")
  [mock] executed: ls -la

[DEMO] Running blocked call: runShell("rm -rf /")
  [BLOCKED] Tool "runShell" rejected: Blocked by policy "block-destructive-shell"

[DEMO] Running masked secret call: callApi({ apiKey: "sk-<48-char-key>" })
  [mock] api called (key redacted from audit)
  Audit stores: {"apiKey":"[REDACTED_OPENAI_KEY]"}

[DEMO] Verifying audit trail...
[SUCCESS] Audit Verified (3 entries, hash chain intact)

[DEMO] Demo complete. Your .grimdall/ directory now contains:
  .grimdall/config.json      - global configuration
  .grimdall/policies.json    - security policies
  .grimdall/audit.json       - tamper-evident audit trail
```

```text
$ grimdall audit:verify
[SUCCESS] Audit Verified (4 entries, hash chain intact)
```

Raw captures live in `assets/proof-demo.txt` and `assets/proof-audit-verify.txt`. Re-run them any time with `grimdall demo` and `grimdall audit:verify`.

## CLI reference

| Command        | Description                                                               |
| -------------- | ------------------------------------------------------------------------- |
| `init`         | Create `.grimdall/config.json`, policies, and the audit trail             |
| `init --hooks` | Install PreToolUse guard hooks for detected agents                        |
| `mode audit`   | Learn-only mode: record `would_block` decisions without stopping the call |
| `mode enforce` | Hard enforcement: block policy violations and record them                 |
| `demo`         | Run a 10-second zero-config demo (allow, block, mask)                     |
| `doctor`       | Run health checks (config, policies, audit, hooks, Slack)                 |
| `login`        | Optional: link the cloud dashboard. Never required                        |
| `audit:verify` | Verify the integrity of the audit trail hash chain                        |
| `audit:view`   | Pretty-print the audit trail as a table                                   |
| `--help`       | Show usage information                                                    |
| `--version`    | Show the CLI version                                                      |

## Development

```bash
npm run build   # compile all TypeScript packages
npm test        # run the unit test suite (Vitest)
npm run lint    # ESLint + Prettier checks
```

## License

Apache-2.0. Copyright (c) 2026 Grimdall Technologies.
