# Grimdall

Runtime security for AI coding agents.

Stop rogue AI agents from deleting production. Grimdall sits between your AI agents and their tools. If an agent tries to run destructive shell commands, drop database tables, or modify production configs, Grimdall blocks it instantly.

## Quickstart

```bash
npx grimdall init       # Protect your agents in 10 seconds
npx grimdall init --yes # Non-interactive mode
```

## What it does

- **Block destructive commands** — instantly stop `rm -rf /`, database drops, and production config changes
- **Mask secrets** — redact keys/tokens/emails before they leave your machine
- **Detect prompt injections** — catch jailbreaks before policy evaluation
- **Enforce policies** — block, allow, or require review for any tool call
- **Tamper-evident audit trail** — SHA-256 hash chain, verifiable, exportable

## Supported agents

- Claude Code
- Cursor
- Codex
- LangGraph
- Custom agents via Node.js or Python SDK

## Learn more

- [Documentation](https://grimdall.site/docs)
- [GitHub](https://github.com/grimdalltech/grimdall-os)
- [Community](https://discord.gg/grimdall)

## License

Apache-2.0
