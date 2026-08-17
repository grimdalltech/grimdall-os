# Policies

The six default policies, shipped and enforced by default.

## The six default policies

| id                          | action  | matches    | stops                                             |
| --------------------------- | ------- | ---------- | ------------------------------------------------- |
| `block-destructive-shell`   | block   | `rm -rf`   | wiping your filesystem                            |
| `block-fork-bomb`           | block   | `:(){`     | freezing your machine                             |
| `block-sql-destructive`     | block   | `DROP TABLE` | deleting your data                             |
| `block-sql-truncate`        | block   | `TRUNCATE` | emptying your tables                              |
| `block-path-traversal`      | block   | `..\`      | escaping your sandbox                             |
| `review-network-commands`   | review  | `curl `    | network calls, which need a human look            |

`block` stops the call and records it. `review` logs the call and lets it proceed so a human can judge later.

## Where they live

- `packages/core/src/default-policies.ts` (core engine, used by the Node SDK, CLI, and hooks)
- `packages/python/grimdall/defaults.py` (Python SDK, identical contents)

Running `grimdall init` copies the defaults into `.grimdall/policies.json`. Edit that file to tune a project. Workspaces get their own copy at `workspaces/<id>/policies.json`, created by `grimdall workspace:create`.

## Presets

Curated preset packs (GitHub, Shell, Deploys, Data) are coming soon. Today you build from the six defaults above.
