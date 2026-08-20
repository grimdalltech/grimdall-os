<div align="center">
  <img src="assets/readme-banner.png" alt="Grimdall — runtime security for AI agents" width="75%" />

  <strong>Runtime security for AI agents.</strong> Stops the tool calls that would delete your repo, nuke your shell, or leak your keys, then writes a tamper-evident, SHA-256 hash-chained audit trail you can verify with one command. Runs fully local: no signup, no telemetry, no API key.

  [![npm](https://img.shields.io/npm/v/grimdall)](https://www.npmjs.com/package/grimdall)
  [![PyPI](https://img.shields.io/pypi/v/grimdall)](https://pypi.org/project/grimdall/)
  [![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
  [![ci](https://github.com/grimdalltech/grimdall-os/actions/workflows/ci.yml/badge.svg)](https://github.com/grimdalltech/grimdall-os/actions/workflows/ci.yml)
  [![X](https://img.shields.io/badge/X-@Grimdal__Sec-000?logo=x)](https://x.com/Grimdal_Sec)

<p align="center">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude_Code-✓-22c55e?style=for-the-badge&labelColor=0B0E14" />
  <img alt="Cursor" src="https://img.shields.io/badge/Cursor-✓-22c55e?style=for-the-badge&labelColor=0B0E14" />
  <img alt="Codex" src="https://img.shields.io/badge/Codex-✓-22c55e?style=for-the-badge&labelColor=0B0E14" />
  <img alt="LangChain" src="https://img.shields.io/badge/LangChain-✓-22c55e?style=for-the-badge&labelColor=0B0E14" />
  <img alt="CrewAI" src="https://img.shields.io/badge/CrewAI-✓-22c55e?style=for-the-badge&labelColor=0B0E14" />
  <img alt="OpenAI Agents SDK" src="https://img.shields.io/badge/OpenAI_Agents_SDK-✓-22c55e?style=for-the-badge&labelColor=0B0E14" />
  <img alt="AutoGen" src="https://img.shields.io/badge/AutoGen-✓-22c55e?style=for-the-badge&labelColor=0B0E14" />
</p>

  ![grimdall demo](assets/demo.gif)
</div>

## 🔥 The Problem

You gave an AI coding agent terminal access so it could actually do work. But AI has senior engineer confidence and intern judgment.

- Agent hallucinates a variable? It runs `DROP TABLE users;`.
- Agent gets stuck in a loop? It force-pushes to `main`.
- Agent reads a poisoned webpage? It executes arbitrary shell commands.

By the time you realize what happened, your app is down.

## ⚡ Quickstart (Zero Friction)

No signup. No API key. No telemetry. Works offline. $0 forever.

**Node CLI** (protects Claude Code, Cursor, Codex):

```bash
npx grimdall init --hooks
```

**Python** (LangChain, CrewAI, OpenAI Agents SDK, AutoGen):

```bash
pip install grimdall
```

```python
from grimdall import guard

@guard.wrap  # That's it. Your agent is now blast-resistant.
def my_agent_function(prompt):
    # your agent logic here
```

## Why This Exists

AI agents are no longer just generating text. They are generating structured tool calls that interface with production databases, cloud infrastructure, and shell environments. When you grant an agent access to high-privilege tools (`run_shell_command`, `github_delete_repo`), it acts as a deputy on your behalf. 

If that agent's context window is poisoned by untrusted data—a hidden payload in a GitHub issue, an email, or a web page—the LLM can be manipulated into issuing malicious, yet syntactically valid, tool calls. The orchestration framework sees a valid JSON request from an authorized agent and executes it. 

This is the **AI Confused Deputy** problem. 

Current mitigations try to solve this at the prompt layer using "LLM-as-a-judge" guardrails. This fails for three reasons:
1. **Non-determinism:** Security controls cannot be probabilistic. Obfuscation bypasses classifiers.
2. **Latency:** Secondary inference adds 600ms–1.2s per tool call, destroying agent economics.
3. **Parameter smuggling:** Validating the tool name isn't enough. A benign `http_request` tool can carry a destructive payload.

Prompt security attempts to persuade the agent to behave. **Execution security constrains what the agent can cause.**

Grimdall exists to provide that execution boundary. It is a deterministic Policy Enforcement Point (PEP) that sits between your agent's reasoning loop and the host OS. It intercepts tool calls via O(1) policy checks (<2ms), isolates shell execution in networkless containers (`--network none`), and maintains tamper-proof cryptographic audit logs. 

Even if an agent's reasoning is fully compromised, its ability to execute destructive actions is structurally contained.

> Read the full formalization: [Mitigating the Confused Deputy Problem in LLM Agents](https://grimdall.site/research)

---

## 🤖 Vibe Coder?

Paste this to your agent and go:

> Integrate grimdall into this project by following AGENT_INTEGRATIONS.md in github.com/grimdalltech/grimdall-os

## 🧪 Try It in 30 Seconds

```bash
npx grimdall demo        # watch it block rm -rf / live
grimdall audit:verify    # prove the hash chain is intact
grimdall doctor          # sanity-check your setup
```

## 🛠️ How It Works (The Solution)

Every tool call goes through the Grimdall core loop:

```
tool call → intercept → evaluate policy → allow / block / review → hash-chained audit
```

**Default protections (out of the box):**

- Blocks destructive shell calls: `rm -rf` and fork bombs.
- Blocks destructive SQL: `DROP TABLE` and `TRUNCATE`.
- Blocks path-traversal patterns (`..\`).
- Forces network commands (`curl`) to human-in-the-loop review.
- Secret masking (redacts API keys and tokens before they're written to the audit log).
- Prompt-injection detection (shell-destructive, SQL, and path-traversal patterns) with a weighted risk score.

## Custom Agent Harnesses

**You own the loop. Grimdall owns the boundary.**

Teams are ditching off-the-shelf agents and building their own coding harnesses — custom tool loops, custom context management, custom runtimes. The harness is where the agent meets the OS, and that is exactly where the security boundary belongs.

Grimdall plugs into your tool execution path with one wrapper. No planner rewrite. No model change.

```
LLM planner (untrusted)
        |  proposes tool call
        v
Your harness loop (context · retries · memory)
        |  every tool call
        v
+-------------------------------+
|  GRIMDALL CHECKPOINT          |
|  allow · block · review ·     |
|  mask · audit                 |
+-------------------------------+
        |  approved actions only
        v
Execution (shell · files · git · APIs)
```

### One wrapper, any language

Python:

```python
from grimdall import guard

@guard  # <- the only line you add
def run_tool(name, args):
    return execute(name, args)
```

Node:

```js
import { guard } from "grimdall";

const runTool = guard(async (name, args) => {
  return execute(name, args);
}); // <- the only line you add
```

### Guarantees

- **Fail-closed by default** — unknown tools and unparseable payloads are blocked or escalated, never silently executed.
- **Deterministic policy engine** — O(1) allow/deny evaluation in under 2ms, no LLM in the hot path.
- **Tamper-evident audit** — every decision committed to a SHA-256 hash chain, signed with ed25519.

### Get started

```bash
pip install grimdall      # or: npx grimdall init --hooks
grimdall doctor
grimdall demo
grimdall audit:verify
```

Full architecture: [Custom Harness guide](https://grimdall.site/#custom-harness) · [White paper](https://grimdall.site/white-papers) · [Research paper](https://grimdall.site/research)

## 🧩 Features

**The unique part: cross-language audit trail.** Most tools support one language. Grimdall has a Node CLI and a Python runtime — both write to the exact same SHA-256 hash-chained, tamper-evident audit trail. Verify what your Python LangChain agent did using the Node CLI. Cryptographic proof of what was attempted, whether it was blocked, and when.

- **Policy enforcement** — declarative `allow` / `block` / `review` policies with wildcard tool matching.
- **Secret masking** — deep-clones call arguments and redacts OpenAI keys, AWS keys, GitHub tokens, bearer tokens.
- **Injection detection** — weighted risk score for shell-destructive, SQL-destructive, and path-traversal patterns.
- **Human-in-the-loop Slack alerts** — blocked calls can ping a Slack webhook in real time.
- **`grimdall demo`** — watch it block `rm -rf /` live.
- **`grimdall audit:verify`** — one command proves the chain is intact.
- **Audit export** — `grimdall audit export` to JSON/CSV for your SOC team.
- **Safer-alternative suggestions** — when a command is blocked, suggest the safe version.

## 🎚️ Modes: Audit vs Enforce

- **`audit`** (shadow / learn-only mode): logs what *would* be blocked, blocks nothing. Run this for a week before switching.
- **`enforce`**: real blocking + review gates.

Switch with the CLI (`grimdall mode audit` → learn-only, `grimdall mode enforce` → hard enforcement). Start in `audit`, graduate to `enforce`.

## ⚠️ Caution — Read This

> Grimdall is a guardrail, not a force field. It reduces blast radius — it does not replace sandboxing, least-privilege credentials, or backups. Run agents with the smallest permissions possible, keep immutable backups, and treat `review` actions as real decisions, not checkbox clicks.

## 📋 Compliance

Grimdall writes a tamper-evident, hash-chained record of every tool call it evaluates. Each entry is signed with an ed25519 key and commits to the previous hash — alter any entry and the chain breaks. You can verify integrity with grimdall audit:verify and inspect the log with grimdall audit:view.


Grimdall is evidence infrastructure, not a certified compliance product.

## 🗺️ Roadmap

- **Spend guardrails** — hard budget caps per agent (alert → review → block on token/cost spend).
- **Trust layer** — Ed25519 agent identity and signed intent capsules.
- **Industry policy packs** — fintech/healthcare presets aligned to SOC 2 / HIPAA-style frameworks.

## 💬 Community & Support

- 🐛 [Report a bug / request a feature](https://github.com/grimdalltech/grimdall-os/issues)
- 📧 aniket@grimdall.site

---

## FAQ

<details>
<summary><strong>Isn't this just another prompt guardrail?</strong></summary>
No. Prompt guardrails try to persuade the model to behave. Grimdall enforces at the execution layer: every tool call is evaluated by a deterministic policy engine before it reaches the OS. The model can propose anything. Only approved actions execute.
</details>

<details>
<summary><strong>What's the latency overhead?</strong></summary>
Under 2ms for policy decisions — an O(1) lookup plus AST evaluation, with no LLM in the hot path. Sandboxed shell execution runs ~200ms with a warm pool (~1.5s cold start). For comparison, LLM-as-a-judge guardrails add 600ms–1.2s per call.
</details>

<details>
<summary><strong>Won't it false-positive and break my flow?</strong></summary>
Start in shadow mode: every call is evaluated, nothing is blocked, and you see exactly what would have been denied. Tune against real traffic, then flip to enforce. Shell parsing is AST-based — it evaluates command + flags + resolved paths, so <code>rm -rf ./build</code> and <code>rm -rf ~</code> are different decisions, not keyword matches.
</details>

<details>
<summary><strong>Fail-open or fail-closed?</strong></summary>
Fail-closed. Unparseable commands, unknown tools, and policy failures are blocked or escalated for human review. Never silently executed.
</details>

<details>
<summary><strong>Do I need to change my agent, model, or prompts?</strong></summary>
No. Grimdall wraps the tool execution path, not the planner. Native hooks for Claude Code, Cursor, and Codex. MCP proxy for MCP-based stacks. One decorator for custom Python or Node harnesses.
</details>

<details>
<summary><strong>Can the agent just disable it or edit its own config?</strong></summary>
Not by default. Writes to the agent's own config directory, hooks, and Grimdall policy files are denied or require human approval. The enforcement point is independent of the process it constrains.
</details>

<details>
<summary><strong>Doesn't --network none break npm install and legit network calls?</strong></summary>
Only shell execution routed into the sandbox loses network. Reads and allowlisted destinations run normally or through an egress proxy with a destination allowlist. You choose what goes in the networkless container.
</details>

<details>
<summary><strong>Where does my code and telemetry go?</strong></summary>
Nowhere. Local-first: policies, evaluation, and the audit trail live on your machine. The hosted platform adds team policy and approvals, but payloads stay in your environment.
</details>

<details>
<summary><strong>How is this different from plain Docker sandboxing or AgentPaaS?</strong></summary>
Sandboxing limits blast radius but decides nothing. Grimdall adds the decision layer — allow, block, review — plus a tamper-evident record of every decision. Furthermore, platforms that only secure the container at the egress boundary miss parameter smuggling (a benign tool carrying a destructive payload). Grimdall intercepts at the tool-call boundary via AST parsing, strictly before execution, on the harness you already run.
</details>

<details>
<summary><strong>Is the audit log actually tamper-evident?</strong></summary>
Every decision is signed with ed25519 and appended to a SHA-256 hash chain where each receipt commits to the previous hash. An agent that edits history breaks the chain. Export signed checkpoints to append-only storage for truncation resistance.
</details>

<details>
<summary><strong>What does it NOT protect against?</strong></summary>
Stateful memory poisoning (a poisoned vector retrieved in a later session), and any path that bypasses the boundary — CI jobs, background workers, or plugins not wired through the hook. If a tool call doesn't cross the PEP, it's outside coverage. It is also not a replacement for least privilege, independent backups, or a compliance program.
</details>

<details>
<summary><strong>Does it replace my orchestrator or harness?</strong></summary>
No. LangGraph, CrewAI, AutoGen, and Claude Code still plan and run the work. Orchestration coordinates the swarm. The harness runs the work. Grimdall controls the consequences.
</details>

<details>
<summary><strong>What's the license and what does it cost?</strong></summary>
The CLI and runtime are open source under Apache-2.0, free locally forever. The hosted platform (team workspaces, SSO/SAML, managed policy packs) lives behind a demo.
</details>

---

Apache-2.0 License. Built by a solo founder who got tired of being terrified of his own code. If this saved your prod database, give it a star. 🙏