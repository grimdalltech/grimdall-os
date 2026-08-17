import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICIES } from 'grimdall-core';

const RUNNER = join(__dirname, '..', 'hooks', 'pre-tool-use.js');

function makeProjectDir(mode: 'audit' | 'enforce'): string {
  const dir = mkdtempSync(join(tmpdir(), 'grimdall-hook-run-'));
  const dot = join(dir, '.grimdall');
  mkdirSync(dot, { recursive: true });
  writeFileSync(join(dot, 'config.json'), JSON.stringify({ version: 1, mode }, null, 2), 'utf8');
  writeFileSync(join(dot, 'policies.json'), JSON.stringify(DEFAULT_POLICIES, null, 2), 'utf8');
  writeFileSync(join(dot, 'audit.json'), JSON.stringify([], null, 2), 'utf8');
  return dir;
}

function runHook(dir: string, input: Record<string, unknown>): { output: any; audit: any[] } {
  const stdout = execFileSync(process.execPath, [RUNNER, '--agent', 'claude', '--project', dir], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  const audit = JSON.parse(readFileSync(join(dir, '.grimdall', 'audit.json'), 'utf8'));
  return { output: JSON.parse(stdout), audit };
}

describe('pre-tool-use.js hook runner', () => {
  it('allows safe calls in enforce mode', () => {
    const dir = makeProjectDir('enforce');
    const { output, audit } = runHook(dir, {
      tool_name: 'runShell',
      tool_input: { cmd: 'ls -la' },
    });
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(audit).toHaveLength(1);
    expect(audit[0].decision).toBe('allowed');
  });

  it('blocks policy violations in enforce mode', () => {
    const dir = makeProjectDir('enforce');
    const { output, audit } = runHook(dir, {
      tool_name: 'runShell',
      tool_input: { cmd: 'rm -rf /' },
    });
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(audit[0].decision).toBe('blocked');
    expect(audit[0].policy_matched).toBe('block-destructive-shell');
  });

  it('records would_block and allows the call in audit mode', () => {
    const dir = makeProjectDir('audit');
    const { output, audit } = runHook(dir, {
      tool_name: 'runShell',
      tool_input: { cmd: 'rm -rf /' },
    });
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(audit[0].decision).toBe('would_block');
    expect(audit[0].policy_matched).toBe('block-destructive-shell');
  });

  it('blocks prompt-injection payloads in enforce mode', () => {
    const dir = makeProjectDir('enforce');
    const { output, audit } = runHook(dir, {
      tool_name: 'runShell',
      tool_input: { cmd: 'rm -rf / && DROP TABLE users' },
    });
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(audit[0].policy_matched).toBe('prompt-injection-scan');
  });

  it('masks secrets in the audit entry and keeps the hash chain valid', () => {
    const dir = makeProjectDir('enforce');
    const first = runHook(dir, { tool_name: 'runShell', tool_input: { cmd: 'ls -la' } });
    const second = runHook(dir, {
      tool_name: 'callApi',
      tool_input: { apiKey: 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL' },
    });
    expect(JSON.stringify(second.audit[1].arguments_masked)).not.toContain('sk-');
    expect(first.audit[0].current_hash).toBe(second.audit[0].current_hash);
  });
});
