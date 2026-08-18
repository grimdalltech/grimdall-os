<div align="center">
<img src="assets/readme-banner.png"
alt="Grimdall — runtime security for AI agents" width="75%" />

![grimdall demo](assets/demo.gif)


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
