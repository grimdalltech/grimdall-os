import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditTrail } from 'grimdall-core';
import { cmdDemo } from './index';

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'grimdall-demo-'));
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

describe('cmdDemo', () => {
  it('auto-creates .grimdall and runs the full demo', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await cmdDemo();

    spy.mockRestore();

    expect(existsSync(join(process.cwd(), '.grimdall', 'config.json'))).toBe(true);
    expect(existsSync(join(process.cwd(), '.grimdall', 'policies.json'))).toBe(true);
    expect(existsSync(join(process.cwd(), '.grimdall', 'audit.json'))).toBe(true);

    const full = logs.join('\n');
    expect(full).toContain('[SUCCESS] Audit Verified');
    expect(full).toContain('hash chain intact');
  });

  it('demonstrates allowed, blocked, and masked calls', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });

    await cmdDemo();

    spy.mockRestore();

    const full = logs.join('\n');
    expect(full).toContain('executed: ls -la');
    expect(full).toContain('[BLOCKED]');
    expect(full).toContain('REDACTED_OPENAI_KEY');
  });

  it('leaves a valid audit chain in .grimdall', async () => {
    await cmdDemo();

    const trail = new AuditTrail(join(process.cwd(), '.grimdall'));
    expect(trail.entriesCount()).toBeGreaterThan(0);
    expect(() => trail.verify()).not.toThrow();

    const raw = JSON.parse(readFileSync(join(process.cwd(), '.grimdall', 'audit.json'), 'utf8'));
    expect(Array.isArray(raw)).toBe(true);
  });
});
