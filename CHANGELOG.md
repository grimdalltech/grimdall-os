# Changelog

All notable changes to this project are documented in this file.

## [0.3.0] - 2026-08-21

### Added

- **Trust layer** — Ed25519 agent identity (`grimdall identity init`) and signed intent capsules (`grimdall intent`). Every audit entry is now signed with the agent's Ed25519 key in addition to the SHA-256 hash chain. `grimdall audit verify` checks both chain integrity and signatures. Intent capsules carry task, scope, expiry, and a cryptographic signature, enabling `requires_intent: true` policy for review-tier actions.
- `@grimdall/cli` (`npx grimdall init`) with Node, Python, LangGraph, and Claude Code wrapper generation.
- `grimdall-node` Node SDK with `createGrimdall()`, `guardTool()`, and sensitive-argument redaction.
- `grimdall` Python SDK with `Grimdall`, `guard_tool()`, and sensitive-argument redaction.
- Local policy engine (`lib/`): policy evaluation, allowlists, prompt-injection detection, remediation suggestions, shell-command inspection, and tamper-evident audit-chain verification.

### Notes

- SDKs and CLI require a `GRIMDALL_ENDPOINT` (set via env var or `--endpoint`). Point it at your own policy service or use the `lib/` engine directly.
