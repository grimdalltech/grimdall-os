# Architecture

Grimdall is a runtime security layer for AI agents. It sits between an agent and its tools, evaluating every tool call before execution and recording an unforgeable record of what happened.

## Components

### grimdall-core

The engine. It has no dependencies on the other packages.

- **PolicyEngine** - Holds a list of `Policy` objects and evaluates `ToolCall`s. Injection detection runs first; a risk score above 75 blocks the call immediately. Otherwise the first matching policy determines the decision. With no matching policy the call is allowed by default. Blocked calls also trigger a Slack alert hook when configured.
- **maskSecrets** - Deep-clones any object and applies regex-based redaction to string values: OpenAI keys (`sk-...`), AWS access keys (`AKIA...`), GitHub tokens (`ghp_...`), and generic bearer tokens. The original object is never mutated.
- **detectInjections** - Scores an input string against three pattern families: shell-destructive and SQL-destructive (50 points each, critical), and path traversal (25 points, high). Scores are summed.
- **AuditTrail** - Appends `AuditEntry`s to a JSON file and chains them with SHA-256.

### grimdall-node

The SDK. `createGrimdall(config)` wires a `PolicyEngine` and an `AuditTrail` together. `wrapTool(fn, name)` returns a new function that, on every call:

1. Normalizes arguments (a single plain object is used directly; otherwise arguments are wrapped in an `args` array).
2. Masks secrets for logging.
3. Evaluates the call against the policy engine.
4. Appends an audit entry (with masked arguments and the decision).
5. Throws `[BLOCKED]` if blocked, otherwise executes the original function.

### grimdall

A thin developer tool over `grimdall-core`:

- `init` writes `grimdall.config.json` (default policies plus a `SLACK_WEBHOOK_URL` placeholder) and `grimdall-audit.json` (empty array).
- `audit:verify` loads the audit file and runs `AuditTrail.verify()`.
- `audit:view` renders the audit log as a table.

## Audit trail design

Each entry records the tool name, masked arguments, the decision, and the matched policy (if any). Chaining works as follows:

- The first entry's `previous_hash` is the literal string `GENESIS`.
- Each entry's `current_hash` is `SHA-256(JSON.stringify(entryWithoutHashFields) + previousHash)`.
- The next entry's `previous_hash` is set to the previous entry's `current_hash`.

Verification replays the chain from the beginning. Any change to a stored decision, argument, hash, or ordering breaks the chain and causes `verify()` to throw. The audit file is safe to commit, because arguments are stored pre-masked and the hash chain is self-verifying.

## Threat model

Grimdall protects against:

- Destructive tool calls issued by an agent, whether by misconfiguration or prompt injection.
- Secrets leaking into audit logs, trace storage, or downstream consumers.
- Silent log tampering by a party with write access to the audit file.

It is not a sandbox: the wrapped tool still executes on the host. Policy is a control layer, not an isolation boundary.
