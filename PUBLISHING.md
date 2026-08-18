# Publishing Grimdall to npm

Grimdall is an npm-workspaces monorepo. Three packages get published to npm:

| Package | npm name        | Purpose                                        |
| ------- | --------------- | ---------------------------------------------- |
| core    | `grimdall-core` | Policy engine, masking, detection, audit trail |
| node    | `grimdall-node` | Node.js/TypeScript SDK                         |
| cli     | `grimdall`      | Command line tool (`grimdall` binary)          |

The root `package.json` is `"private": true` and is never published. `grimdall-node`
and `grimdall` depend on `grimdall-core`, so **publish core first**.

## Prerequisites

### 1. Create an npm account

1. Go to https://www.npmjs.com/signup and create an account.
2. Verify your email address (npm will block publishing until you do).

### 2. Use the unscoped package names

We publish from the `grimdalldev` account using the unscoped package names:

1. `grimdall-core`
2. `grimdall-node`
3. `grimdall`

### 3. Log in to npm

```bash
npm login
```

You will be prompted for your username, password, and one-time passcode (if you
have 2FA enabled, which is recommended).

Verify you are logged in:

```bash
npm whoami
```

## Build and publish

Every package has a `prepublishOnly` script that runs `npm run build` before the
tarball is packed, so you never publish stale `dist/` output.

### Step 1 — core

```bash
npm install                       # from the repo root
npm run build                     # ensure everything compiles
npm publish -w packages/core --access public
```

### Step 2 — node

```bash
npm publish -w packages/node --access public
```

### Step 3 — cli

```bash
npm publish -w packages/cli --access public
```

Publishing in this order matters: `grimdall-node` and `grimdall` resolve
`grimdall-core@^0.1.0` from the registry, so core must exist first.

## Verify the install

From a clean directory (not the repo), confirm the CLI installs and runs:

```bash
mkdir /tmp/grimdall-check && cd /tmp/grimdall-check
npx -y grimdall@latest --version
npx -y grimdall@latest init
```

And that the SDK resolves:

```bash
npm init -y
npm install grimdall-node
node -e "const { createGrimdall } = require('grimdall-node'); const g = createGrimdall({ auditPath: 'audit.json' }); console.log(typeof g.wrapTool);"
```

## Versioning and releasing updates

When you ship a change that touches `grimdall-core`, bump its version, then bump
the `grimdall-core` dependency range in `node` and `cli` if needed and publish in
the same order (core → node → cli). For example:

```bash
npm version patch -w packages/core
npm version patch -w packages/node
npm version patch -w packages/cli
npm publish -w packages/core
npm publish -w packages/node
npm publish -w packages/cli
```

## Local trial before publishing (recommended)

Before the very first publish, try the CLI from the repo with `npm link`:

```bash
npm run build
npm link -w packages/cli
grimdall --version
grimdall init
```

Or run it without linking:

```bash
node packages/cli/bin/grimdall.js --version
```

## Notes

- Never commit `dist/` or `node_modules/` (both are gitignored).
- Never commit real Slack tokens or secrets. `grimdall.config.json`/`.grimdall/config.json`
  should hold placeholder values only.
- The CLI ships the agent hook runner at `packages/cli/hooks/pre-tool-use.js`; it is
  copied into a project's `.grimdall/hooks/` when you run `grimdall init --hooks`.
