import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdInit, cmdLogin, cmdMode } from './index';

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'grimdall-mode-'));
}

let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  process.chdir(makeProjectDir());
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

describe('cmdMode', () => {
  it('reports the default enforce mode when nothing is configured', async () => {
    const logs = await capture(() => cmdMode(undefined));
    const full = logs.join('\n');
    expect(full).toContain('enforce (default)');
    expect(process.exitCode).not.toBe(1);
  });

  it('sets audit mode in .grimdall/config.json', async () => {
    await cmdInit({});
    const logs = await capture(() => cmdMode('audit'));
    expect(logs.join('\n')).toContain('[SUCCESS] Mode set to audit.');
    const config = JSON.parse(
      readFileSync(join(process.cwd(), '.grimdall', 'config.json'), 'utf8'),
    );
    expect(config.mode).toBe('audit');
  });

  it('sets enforce mode and reports success', async () => {
    await cmdInit({});
    const logs = await capture(() => cmdMode('enforce'));
    expect(logs.join('\n')).toContain('[SUCCESS] Mode set to enforce.');
    const config = JSON.parse(
      readFileSync(join(process.cwd(), '.grimdall', 'config.json'), 'utf8'),
    );
    expect(config.mode).toBe('enforce');
  });

  it('rejects unknown modes', async () => {
    const logs = await capture(() => cmdMode('wat'));
    expect(logs.join('\n')).toContain('[ERROR] Invalid mode "wat"');
    expect(process.exitCode).toBe(1);
  });
});

describe('cmdLogin', () => {
  it('explains that login is optional without requiring anything', async () => {
    const logs = await capture(() => cmdLogin());
    const full = logs.join('\n');
    expect(full).toContain('optional');
    expect(full).toContain('no account');
    expect(full).toContain('no telemetry');
    expect(full).not.toContain('[ERROR]');
    expect(process.exitCode).not.toBe(1);
  });
});

describe('cmdInit summary and hook awareness', () => {
  it('prints the success summary with real defaults and audit mode', async () => {
    const dir = process.cwd();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({}, null, 2), 'utf8');

    const logs = await capture(() => cmdInit({ hooks: true }));
    const full = logs.join('\n');

    expect(full).toContain('[SUCCESS] Grimdall initialized.');
    expect(full).toContain('✓ Protected: Claude Code');
    expect(full).toContain('- Cursor: not detected, skipped');
    expect(full).toContain('- Codex: not detected, skipped');
    expect(full).toContain(
      '✓ Active policies: block-destructive-shell, block-fork-bomb, block-sql-destructive, block-sql-truncate, block-path-traversal, review-network-commands',
    );
    expect(full).toContain('✓ Mode: audit (learn-only)');
    expect(full).toContain('→ See it work: npx grimdall demo');
    expect(full).toContain('→ Verify hooks: npx grimdall doctor');
    expect(full).toContain('Local-only. No signup. No telemetry.');

    const config = JSON.parse(readFileSync(join(dir, '.grimdall', 'config.json'), 'utf8'));
    expect(config.mode).toBe('audit');
  });

  it('skips agents gracefully when none are installed', async () => {
    const logs = await capture(() => cmdInit({ hooks: true }));
    const full = logs.join('\n');
    expect(full).toContain('- Claude Code: not detected, skipped');
    expect(full).toContain('- Cursor: not detected, skipped');
    expect(full).toContain('- Codex: not detected, skipped');
    expect(full).not.toContain('✓ Protected:');
    expect(process.exitCode).not.toBe(1);
  });
});
