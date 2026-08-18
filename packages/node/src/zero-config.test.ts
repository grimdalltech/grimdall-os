import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Policy } from 'grimdall-core';
import { createGrimdall } from '../src/index';

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'grimdall-zero-'));
}

describe('createGrimdall zero-config', () => {
  it('auto-creates .grimdall and wraps tools with no configuration', () => {
    const dir = makeProjectDir();
    const grimdall = createGrimdall({ projectDir: dir });

    expect(existsSync(join(dir, '.grimdall', 'config.json'))).toBe(true);
    expect(existsSync(join(dir, '.grimdall', 'policies.json'))).toBe(true);
    expect(existsSync(join(dir, '.grimdall', 'audit.json'))).toBe(true);

    const wrapped = grimdall.wrapTool((cmd: string) => `ran: ${cmd}`, 'runShell');
    expect(wrapped('ls')).toBe('ran: ls');
    expect(() => grimdall.auditTrail.verify()).not.toThrow();
  });

  it('does not overwrite existing .grimdall files', () => {
    const dir = makeProjectDir();
    const configPath = join(dir, '.grimdall', 'config.json');
    mkdirSync(join(dir, '.grimdall'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ version: 1, SLACK_WEBHOOK_URL: 'https://example.com/webhook' }, null, 2),
      'utf8',
    );

    const grimdall = createGrimdall({ projectDir: dir });
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.SLACK_WEBHOOK_URL).toBe('https://example.com/webhook');
    expect(grimdall).toBeDefined();
  });

  it('honors policies.json written into .grimdall', () => {
    const dir = makeProjectDir();
    const policies: Policy[] = [
      { id: 'block-rm', tool: '*', action: 'block', condition: 'arg_contains', value: 'rm -rf' },
    ];
    mkdirSync(join(dir, '.grimdall'), { recursive: true });
    writeFileSync(
      join(dir, '.grimdall', 'policies.json'),
      JSON.stringify(policies, null, 2),
      'utf8',
    );

    const grimdall = createGrimdall({ projectDir: dir });
    const wrapped = grimdall.wrapTool((cmd: string) => cmd, 'runShell');
    expect(() => wrapped('rm -rf /')).toThrow(/\[BLOCKED\]/);
    expect(grimdall.auditTrail.getEntries()[0].policy_matched).toBe('block-rm');
  });

  it('honors mode: audit from .grimdall/config.json', () => {
    const dir = makeProjectDir();
    mkdirSync(join(dir, '.grimdall'), { recursive: true });
    writeFileSync(
      join(dir, '.grimdall', 'config.json'),
      JSON.stringify({ version: 1, mode: 'audit' }, null, 2),
      'utf8',
    );

    const grimdall = createGrimdall({ projectDir: dir });
    const wrapped = grimdall.wrapTool((cmd: string) => cmd, 'runShell');
    expect(wrapped('rm -rf /')).toBe('rm -rf /');
    const entry = grimdall.auditTrail.getEntries()[0];
    expect(entry.decision).toBe('would_block');
    expect(entry.policy_matched).toBe('block-destructive-shell');
  });

  it('keeps the explicit auditPath API working', () => {
    const dir = makeProjectDir();
    const grimdall = createGrimdall({ auditPath: join(dir, 'audit.json') });
    const wrapped = grimdall.wrapTool((cmd: string) => cmd, 'runShell');
    wrapped('ls');
    expect(existsSync(join(dir, 'audit.json'))).toBe(true);
  });
});
