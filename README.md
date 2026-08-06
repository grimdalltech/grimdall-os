# Grimdall

Open-source runtime security layer for AI agents: policy enforcement, secret masking, prompt-injection detection, and a tamper-evident audit trail.

Grimdall intercepts AI agent tool calls, terminal commands, API actions, and MCP-style requests **before execution** — helping teams block dangerous actions, secret exposure, and prompt-injection-driven tool misuse.

[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![CLI](https://img.shields.io/badge/CLI-grimdall-black)](https://www.npmjs.com/package/grimdall)
[![Node SDK](https://img.shields.io/badge/Node-grimdall--node-black)](https://www.npmjs.com/package/grimdall-node)
[![Python SDK](https://img.shields.io/badge/Python-grimdall-black)](https://pypi.org/project/grimdall/)

## What this repo contains

- **`packages/grimdall-cli`** — `npx grimdall init` one-command setup for a project (Node, Python, LangGraph, Claude Code).
- **`packages/grimdall-node`** — Node SDK (`@grimdall/node`) with `createGrimdall()`, `guardTool()`, and argument redaction.
- **`packages/grimdall-python`** — Python SDK (`grimdall`) with `Grimdall`, `guard_tool()`, and argument redaction.
- **`lib/`** — the local policy engine: policy evaluation, allowlists, prompt-injection detection, remediation suggestions, and tamper-evident audit-chain verification. Fully self-contained, no external runtime dependencies.

The hosted policy management and audit dashboard (Grimdall Cloud) is a separate, private product.

## Quick start

```bash
npx grimdall init
```

This detects your stack, writes `grimdall.config.json`, and generates wrapper examples for your agent tools. Point Grimdall at your own policy endpoint by setting `GRIMDALL_ENDPOINT`, or use the local `lib/` engine directly.

### Node

```js
import { createGrimdall } from "@grimdall/node";

const grimdall = createGrimdall({ endpoint: process.env.GRIMDALL_ENDPOINT });

const deleteRepo = grimdall.guardTool("github_delete_repo", async ({ repoName }) => {
  return { status: "deleted" };
});
```

### Python

```python
from grimdall import Grimdall

grimdall = Grimdall(endpoint="https://your-endpoint/api/execute")

@grimdall.guard_tool("github_delete_repo")
def delete_repo(arguments):
    return {"status": "deleted"}
```

### Local policy engine (no endpoint required)

```js
import { evaluatePolicy } from "./lib/policy-engine.js";
import { inspectShellCommand } from "./lib/policy.js";

const decision = evaluatePolicy("shell_execute", { command: "rm -rf /" });
const inspection = inspectShellCommand("rm -rf /");
```

## Features

- Pre-execution checks for AI agent tool calls
- Policy-based allow, deny, and human-review decisions (`audit` / `enforce` modes)
- Allowlists with scoped rule matching
- Prompt-injection detection
- Secret masking before arguments reach the policy engine
- Remediation suggestions for blocked actions
- Tamper-evident audit-chain verification (`lib/verify-audit-chain.js`)
- CLI, Node SDK, and Python SDK
- Examples for LangGraph, Claude Code, and custom agents

## Development

```bash
npm test        # runs the lib test suite
npm run build   # syntax-checks the engine and SDK sources
```

## License

[Apache-2.0](LICENSE)
