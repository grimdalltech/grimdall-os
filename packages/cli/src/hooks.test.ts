import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHookCommand, buildHookConfig, detectAgentHookTargets, diffLines } from './hooks';

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'grimdall-hooks-'));
}

describe('detectAgentHookTargets', () => {
  it('detects existing agent config files', () => {
    const dir = makeProjectDir();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), '{}', 'utf8');
    mkdirSync(join(dir, '.cursor'), { recursive: true });

    const targets = detectAgentHookTargets(dir);
    const agents = targets.map((target) => target.agent).sort();
    expect(agents).toEqual(['claude', 'cursor']);

    const claude = targets.find((target) => target.agent === 'claude');
    expect(claude?.exists).toBe(true);
    const cursor = targets.find((target) => target.agent === 'cursor');
    expect(cursor?.exists).toBe(false);
  });

  it('returns an empty list when no agents are present', () => {
    const dir = makeProjectDir();
    expect(detectAgentHookTargets(dir)).toEqual([]);
  });
});

describe('buildHookConfig', () => {
  const runner = '/x/.grimdall/hooks/pre-tool-use.js';
  const project = '/x';

  it('builds a Claude Code PreToolUse hook command', () => {
    const command = buildHookCommand(runner, 'claude', project);
    expect(command).toBe('node "/x/.grimdall/hooks/pre-tool-use.js" --agent claude --project "/x"');
  });

  it('creates a Claude Code hook config', () => {
    const config = JSON.parse(buildHookConfig('claude', runner, project, null));
    expect(config.hooks.PreToolUse).toHaveLength(1);
    expect(config.hooks.PreToolUse[0].hooks[0].command).toContain('--agent claude');
  });

  it('merges into an existing config without duplicating the hook', () => {
    const first = buildHookConfig('claude', runner, project, null);
    const second = buildHookConfig('claude', runner, project, first);
    const parsed = JSON.parse(second);
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
  });

  it('preserves existing settings fields when merging', () => {
    const existing = JSON.stringify({ model: 'sonnet', permissions: { allow: ['Bash'] } }, null, 2);
    const merged = JSON.parse(buildHookConfig('claude', runner, project, existing));
    expect(merged.model).toBe('sonnet');
    expect(merged.permissions.allow).toEqual(['Bash']);
    expect(merged.hooks.PreToolUse).toHaveLength(1);
  });

  it('merges even when the existing file has a UTF-8 BOM', () => {
    const existing = '\uFEFF' + JSON.stringify({ model: 'opus' }, null, 2);
    const merged = JSON.parse(buildHookConfig('claude', runner, project, existing));
    expect(merged.model).toBe('opus');
    expect(merged.hooks.PreToolUse).toHaveLength(1);
  });

  it('builds Cursor and Codex config shapes', () => {
    const cursor = JSON.parse(buildHookConfig('cursor', runner, project, null));
    expect(cursor.hooks[0].matcher).toBe('preToolUse');
    expect(cursor.hooks[0].hooks[0].timeout).toBe(5000);

    const codex = JSON.parse(buildHookConfig('codex', runner, project, null));
    expect(codex.hooks[0].matcher).toBe('PreToolUse');
  });
});

describe('diffLines', () => {
  it('shows added, removed, and unchanged lines', () => {
    const output = diffLines('a\nb\n', 'a\nc\n');
    expect(output).toContain('+c');
    expect(output).toContain('-b');
    expect(output).toContain(' a');
  });

  it('returns all added lines for a brand new file', () => {
    const output = diffLines('', '{\n  "a": 1\n}\n');
    expect(output).toContain('+  "a": 1');
    expect(output).not.toContain('-');
  });
});
