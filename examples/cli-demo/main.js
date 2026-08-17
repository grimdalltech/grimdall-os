#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const cli = resolve(__dirname, '..', '..', 'packages', 'cli', 'bin', 'grimdall.js');
const dir = mkdtempSync(join(tmpdir(), 'grimdall-cli-demo-'));

for (const args of [['demo'], ['audit:verify']]) {
  process.stdout.write(execFileSync(process.execPath, [cli, ...args], { cwd: dir }).toString());
}
