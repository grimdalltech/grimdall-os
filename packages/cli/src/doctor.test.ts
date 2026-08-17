import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICIES } from 'grimdall-core';
import { cmdDoctor } from './index';

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'grimdall-doctor-'));
}

function writeDotGrimdall(dir: string): void {
  const dot = join(dir, '.grimdall');
  mkdirSync(dot, { recursive: true });
  writeFileSync(
    join(dot, 'config.json'),
    JSON.stringify({ version: 1, SLACK_WEBHOOK_URL: 'YOUR_WEBHOOK' }, null, 2),
    'utf8',
  );
  writeFileSync(join(dot, 'policies.json'), JSON.stringify(DEFAULT_POLICIES, null, 2), 'utf8');
  writeFileSync(join(dot, 'audit.json'), JSON.stringify([], null, 2), 'utf8');
}

let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  const dir = makeProjectDir();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  process.exitCode = 0;
});

function capture(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    logs.push(String(msg));
  });
  return fn().then(() => {
    spy.mockRestore();
    return logs;
  });
}

describe('cmdDoctor', () => {
  it('reports PASS for a healthy .grimdall setup', async () => {
    writeDotGrimdall(process.cwd());

    const logs = await capture(() => cmdDoctor());

    const full = logs.join('\n');
    expect(full).toContain('[PASS] Config file');
    expect(full).toContain('[PASS] Policies');
    expect(full).toContain('[SUCCESS] All checks passed');
    expect(process.exitCode).not.toBe(1);
  });

  it('reports WARN for optional hooks and Slack when not configured', async () => {
    writeDotGrimdall(process.cwd());

    const logs = await capture(() => cmdDoctor());

    const full = logs.join('\n');
    expect(full).toContain('[WARN] Hook runner');
    expect(full).toContain('[WARN] Agent hooks');
    expect(full).toContain('[WARN] Slack webhook');
  });

  it('reports FAIL and a fix hint when config is missing', async () => {
    const logs = await capture(() => cmdDoctor());

    const full = logs.join('\n');
    expect(full).toContain('[FAIL] Config file');
    expect(full).toContain('grimdall init');
    expect(full).toContain('[WARNING] Some checks failed');
    expect(process.exitCode).toBe(1);
  });

  it('reports FAIL when policies.json is invalid JSON', async () => {
    const dot = join(process.cwd(), '.grimdall');
    mkdirSync(dot, { recursive: true });
    writeFileSync(join(dot, 'config.json'), JSON.stringify({ version: 1 }, null, 2), 'utf8');
    writeFileSync(join(dot, 'policies.json'), 'not-json{{', 'utf8');
    writeFileSync(join(dot, 'audit.json'), JSON.stringify([], null, 2), 'utf8');

    const logs = await capture(() => cmdDoctor());

    expect(logs.join('\n')).toContain('not valid JSON');
  });
});
