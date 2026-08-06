# Contributing to Grimdall

Thanks for helping improve Grimdall.

## Before you open a PR

- Open an issue first for non-trivial changes.
- Keep PRs small and focused.
- Explain the user impact clearly.
- Add tests when behavior changes.

## What gets extra review

- Tool execution flow
- Policy evaluation logic
- API key and auth handling
- Rate limiting and abuse protection
- Anything that affects security boundaries

## Branch workflow

1. Fork the repository.
2. Create a branch: `git checkout -b yourname/description-of-change`
3. Make your changes and add tests.
4. Run `npm test` locally.
5. Push and open a pull request against `main`.

## Development setup

```bash
npm install
npm test
npm run build
```

## Licensing

By contributing, you agree that your contributions are licensed under the
[Apache-2.0](LICENSE) license.
