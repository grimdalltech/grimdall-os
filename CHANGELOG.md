# Changelog

All notable changes to this project are documented in this file.

## [0.3.0] - 2026-08-06

### Added

- Initial open-source release under Apache-2.0.
- `@grimdall/cli` (`npx grimdall init`) with Node, Python, LangGraph, and Claude Code wrapper generation.
- `@grimdall/node` Node SDK with `createGrimdall()`, `guardTool()`, and sensitive-argument redaction.
- `grimdall` Python SDK with `Grimdall`, `guard_tool()`, and sensitive-argument redaction.
- Local policy engine (`lib/`): policy evaluation, allowlists, prompt-injection detection, remediation suggestions, shell-command inspection, and tamper-evident audit-chain verification.

### Notes

- SDKs and CLI require a `GRIMDALL_ENDPOINT` (set via env var or `--endpoint`). Point it at your own policy service or use the `lib/` engine directly.
