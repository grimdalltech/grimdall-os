# grimdall-node

Node SDK for checking AI agent tool calls with [Grimdall](https://grimdall.site).

## Install

```bash
npm install grimdall-node
```

## Usage

```js
import { createGrimdall } from "grimdall-node";

const grimdall = createGrimdall({
  endpoint: process.env.GRIMDALL_ENDPOINT,
  apiKey: process.env.GRIMDALL_API_KEY,
});

// Check if a tool call is allowed
const result = await grimdall.check("shell_execute", { command: "rm -rf /" });
// result.status === "blocked"

// Or throw on blocked calls
await grimdall.assertAllowed("shell_execute", { command: "ls" });

// Wrap a handler with automatic policy enforcement
const safeDelete = grimdall.guardTool("github_delete_repo", async ({ repoName }) => {
  return { status: "deleted" };
});
```

## API

### `createGrimdall(options?)`

Creates a Grimdall client.

- `options.endpoint` — Grimdall API endpoint (or set `GRIMDALL_ENDPOINT` env var)
- `options.apiKey` — API key (or set `GRIMDALL_API_KEY` env var)
- `options.fetch` — Custom fetch implementation (Node 18+ has built-in fetch)

### `grimdall.check(tool, args?)`

Returns a result object with `status: "allowed" | "blocked" | "error"`.

### `grimdall.assertAllowed(tool, args?)`

Same as `check()` but throws `GrimdallPolicyError` if blocked.

### `grimdall.guardTool(tool, handler)`

Wraps an async handler to enforce policies before execution.

### `GrimdallPolicyError`

Thrown when a tool call is blocked. Has a `result` property with details.

### `redactSensitiveArguments(args)`

Utility to redact emails, API keys, tokens, and phone numbers from arguments.

## License

Apache-2.0
