# Contributing

Thanks for showing up. Grimdall is a runtime security layer for AI agents: policy enforcement, secret masking, injection detection, and a tamper-evident audit trail. It is a monorepo with four packages plus the marketing site.

## Repository map

- `packages/core` (`grimdall-core`) policy engine, masking, injection detection, audit trail
- `packages/node` (`grimdall-node`) Node.js and TypeScript SDK
- `packages/cli` (`grimdall`) the command line tool
- `packages/python` (`grimdall`) the Python SDK with framework adapters
- `examples/` runnable examples (`node-basic`, `python-basic`, `cli-demo`, and more)
- `docs/` design and integration docs
- `policies/` default policy documentation

## Setup

Requires Node.js 18+ and Python 3.9+.

```bash
npm ci
npm run build
```

## Tests

The full suite must be green before a PR.

```bash
npm test          # vitest, node and typescript
npm run lint      # eslint + prettier
python -m pip install -e ./packages/python
python -m pip install pytest
python -m pytest packages/python/tests
```

## Making changes

- Small, descriptive commits. One logical change per commit.
- Match the style of the file you touch. TypeScript packages use the shared `tsconfig.base.json` and ESLint config.
- Keep the CLI local-only: no signup, no API key, no telemetry, no network calls in the core path.
- Never document a command that does not exist. If it is not shipped, write "coming soon" and move on.
- Public copy stays plain: no em dashes, no ellipses, no fake badges.

## PR checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `python -m pytest packages/python/tests` passes
- [ ] New behavior is covered by a test in the package it touches
- [ ] README and `docs/` updated when commands or behavior change

## Questions

Open an issue or start a discussion. Keep it focused: one bug or one feature per thread.

## License

Apache-2.0, matching the repo.