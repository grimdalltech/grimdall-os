<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.png">
    <img src="assets/logo.png" alt="Grimdall" width="720">
  </picture>
</p>

<p align="center">
  <strong>stop rogue AI agents before they delete production</strong>
</p>

<p align="center">
  Runtime security layer for AI coding agents.<br>
  <strong>Block destructive commands. Mask secrets. Detect prompt injections.</strong><br>
  <em>Sits between your agents (Claude Code, Cursor, Codex) and their tools.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/25391" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/25391" alt="grimdalltech%2Fgrimdall-os | Trendshift" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="https://github.com/grimdalltech/grimdall-os/stargazers"><img src="https://img.shields.io/github/stars/grimdalltech/grimdall-os?style=flat&color=yellow" alt="Stars"></a>
  <a href="https://www.npmjs.com/package/grimdall"><img src="https://img.shields.io/npm/v/grimdall?color=red&label=npm" alt="npm version"></a>
  <a href="https://github.com/grimdalltech/grimdall-os/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://discord.gg/grimdall"><img src="https://img.shields.io/discord/123456789?color=7289da&label=discord&logo=discord" alt="Discord"></a>
</p>

<p align="center">
  <a href="#what-is-grimdall">What is it</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#compatible-with">Compatible agents</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="#community-and-contributing">Community</a> ·
  <a href="#license">License</a>
</p>

---


## What is Grimdall?

Pointing an AI agent at your codebase without runtime security is like giving a toddler a chainsaw. **Grimdall is the runtime security layer** that stops agents from:

- Running destructive shell commands (`rm -rf /`, `chmod 777`, fork bombs)
- Leaking secrets (API keys, tokens, credentials)
- Modifying production configs
- Executing prompt injections

It sits between your agents (Claude Code, Cursor, Codex) and their tools, enforcing policies in real-time.

## What it does

- **Block destructive commands** — instantly stop `rm -rf /`, database drops, and production config changes.
- **Mask secrets** — redact keys/tokens/emails before they leave your machine.
- **Detect prompt injections** — catch jailbreaks before policy evaluation.
- **Enforce policies** — block, allow, or require review for any tool call.
- **Generate safer alternatives** — suggest `rm -rf ./build` instead of `rm -rf /`.
- **Tamper-evident audit trail** — SHA-256 hash chain, verifiable, exportable.

Built in response to real attacks: [Mini Shai-Hulud](https://thehackernews.com/2026/05/mini-shai-hulud-worm-compromises.html) npm supply chain attacks, [Kiro CVE-2026-10591](https://thehackernews.com/2026/07/aws-kiro-flaw-let-poisoned-web-page.html), and the [Hugging Face agent breach](https://thehackernews.com/2026/07/worlds-largest-ai-model-repository.html).

## Compatible with

Grimdall works with **any AI agent that uses tool/function calling**, including:

- **Claude Code** (Anthropic)
- **Cursor** (cursor.sh)
- **Codex** (OpenAI)
- **LangChain** agents
- **CrewAI**
- **Hugging Face** Agents
- **Hermes**
- **OpenClaw**
- Custom Python agents

No configuration needed — just run `grimdall init --hooks` and it auto-detects your agent.

## Getting started

### Quickstart (10 seconds)

```bash
npx grimdall init --hooks  # Protects Claude Code, Cursor, Codex
npx grimdall demo          # Watch it block rm -rf /
```

### Full setup

#### 1. Install CLI

```bash
npm install -g grimdall
```

#### 2. Protect your agents

```bash
grimdall init --hooks
```

#### 3. Run the demo

```bash
grimdall demo
```

> **No configuration needed** — uses default policies for common risks (`rm -rf /`, `chmod 777`, fork bombs, repo deletion).

[See full docs →](https://grimdall.site/docs)

## Documentation

- [Full API reference](https://grimdall.site/docs)
- [Policy engine guide](https://grimdall.site/docs/policy-engine)
- [Agent hook setup](https://grimdall.site/docs/agent-hooks)
- [Supply chain guard](https://grimdall.site/docs/supply-chain-guard)

## Community and contributing

Join our [Discord](https://discord.gg/grimdall) for real-time help and discussions.

- **Questions?** → [GitHub Discussions](https://github.com/grimdalltech/grimdall-os/discussions)
- **Bugs?** → [Open an issue](https://github.com/grimdalltech/grimdall-os/issues/new?labels=bug&template=bug_report.md)
- **Contributing** → [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security** → [SECURITY.md](SECURITY.md)

## License

Grimdall is licensed under the [Apache-2.0 License](LICENSE).
