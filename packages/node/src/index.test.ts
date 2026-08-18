import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Policy } from 'grimdall-core';
import type { SlackAlertAuditEvent } from 'grimdall-core';
import { createGrimdall } from '../src/index';

function makeAuditPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'grimdall-sdk-')), 'audit.json');
}

function makeAlertSender() {
  return vi.fn(
    async ({
      auditLogger,
      agentId,
      reason,
      timestamp,
      tool,
    }: {
      auditLogger?: (event: SlackAlertAuditEvent) => void;
      agentId?: string;
      reason: string;
      timestamp: string;
      tool: string;
    }) => {
      const alertMessage = `[BLOCKED] Agent: ${agentId ?? 'unknown'} | Tool: ${tool} | Risk: [high] | Reason: [${reason}]`;
      auditLogger?.({
        status: 'sent',
        tool,
        agentId: agentId ?? 'unknown',
        risk: 'high',
        reason,
        alertMessage,
        timestamp,
        attempts: 1,
      });

      return { status: 'sent' as const, attempts: 1, alertMessage };
    },
  );
}

describe('createGrimdall', () => {
  it('wraps a tool and allows safe calls', () => {
    const grimdall = createGrimdall({ auditPath: makeAuditPath() });
    const tool = (cmd: string) => `ran: ${cmd}`;
    const wrapped = grimdall.wrapTool(tool, 'runShell');
    expect(wrapped('ls -la')).toBe('ran: ls -la');
    expect(grimdall.auditTrail.entriesCount()).toBe(1);
  });

  it('blocks calls rejected by policy and logs the decision', async () => {
    const policies: Policy[] = [
      { id: 'block-rm', tool: '*', action: 'block', condition: 'arg_contains', value: 'rm -rf' },
    ];
    const alertSender = makeAlertSender();
    const grimdall = createGrimdall({
      policies,
      auditPath: makeAuditPath(),
      slackWebhookUrl: 'https://example.com/webhook',
      alertSender,
    });
    const wrapped = grimdall.wrapTool((cmd: string) => cmd, 'runShell');
    expect(() => wrapped('rm -rf /')).toThrow(/\[BLOCKED\]/);
    await Promise.resolve();
    const entries = grimdall.auditTrail.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].decision).toBe('blocked');
    expect(entries[0].policy_matched).toBe('block-rm');
    expect(entries[1].tool).toBe('slack_alert');
    expect(entries[1].decision).toBe('sent');
    expect(alertSender).toHaveBeenCalledTimes(1);
  });

  it('blocks calls flagged by the injection detector', async () => {
    const alertSender = makeAlertSender();
    const grimdall = createGrimdall({
      auditPath: makeAuditPath(),
      slackWebhookUrl: 'https://example.com/webhook',
      alertSender,
    });
    const wrapped = grimdall.wrapTool((cmd: string) => cmd, 'runShell');
    expect(() => wrapped('rm -rf / && DROP TABLE users')).toThrow(/injection detected/i);
    await Promise.resolve();
    const entries = grimdall.auditTrail.getEntries();
    expect(entries[0].decision).toBe('blocked');
    expect(entries[1].tool).toBe('slack_alert');
    expect(entries[1].decision).toBe('sent');
    expect(alertSender).toHaveBeenCalledTimes(1);
  });

  it('masks secrets before writing to the audit log', () => {
    const grimdall = createGrimdall({ auditPath: makeAuditPath() });
    const wrapped = grimdall.wrapTool((opts: { apiKey: string }) => opts.apiKey, 'callApi');
    wrapped({ apiKey: 'sk-' + 'a'.repeat(48) });
    const entry = grimdall.auditTrail.getEntries()[0];
    expect(entry.arguments_masked.apiKey).toBe('[REDACTED_OPENAI_KEY]');
    expect(JSON.stringify(entry.arguments_masked)).not.toContain('sk-');
  });

  it('treats a single plain-object argument as the arguments record', () => {
    const grimdall = createGrimdall({ auditPath: makeAuditPath() });
    const wrapped = grimdall.wrapTool((opts: { path: string }) => opts.path, 'readFile');
    wrapped({ path: '/etc/passwd' });
    const entry = grimdall.auditTrail.getEntries()[0];
    expect(entry.arguments_masked).toEqual({ path: '/etc/passwd' });
  });

  it('wraps multiple positional arguments into an args record', () => {
    const grimdall = createGrimdall({ auditPath: makeAuditPath() });
    const wrapped = grimdall.wrapTool((a: string, b: number) => `${a}:${b}`, 'concat');
    wrapped('x', 2);
    const entry = grimdall.auditTrail.getEntries()[0];
    expect(entry.arguments_masked).toEqual({ args: ['x', 2] });
  });

  it('returns review decisions without throwing', () => {
    const policies: Policy[] = [
      { id: 'review-all', tool: '*', action: 'review', condition: 'always' },
    ];
    const grimdall = createGrimdall({ policies, auditPath: makeAuditPath() });
    const wrapped = grimdall.wrapTool((cmd: string) => `ok: ${cmd}`, 'runShell');
    expect(wrapped('ls')).toBe('ok: ls');
    expect(grimdall.auditTrail.getEntries()[0].decision).toBe('review');
  });

  it('logs would_block and proceeds when configured for audit mode', () => {
    const policies: Policy[] = [
      { id: 'block-rm', tool: '*', action: 'block', condition: 'arg_contains', value: 'rm -rf' },
    ];
    const grimdall = createGrimdall({ policies, auditPath: makeAuditPath(), mode: 'audit' });
    const wrapped = grimdall.wrapTool((cmd: string) => cmd, 'runShell');
    expect(wrapped('rm -rf /')).toBe('rm -rf /');
    const entry = grimdall.auditTrail.getEntries()[0];
    expect(entry.decision).toBe('would_block');
    expect(entry.policy_matched).toBe('block-rm');
  });

  it('does not crash on circular arguments and keeps the audit chain valid', () => {
    const grimdall = createGrimdall({ auditPath: makeAuditPath() });
    const wrapped = grimdall.wrapTool((opts: Record<string, any>) => opts.value, 'echo');
    const circular: Record<string, any> = { value: 'hello', nested: { deep: true } };
    circular.self = circular;
    circular.nested.parent = circular;

    expect(() => wrapped(circular)).not.toThrow();
    expect(grimdall.auditTrail.entriesCount()).toBe(1);
    const entry = grimdall.auditTrail.getEntries()[0];
    expect(entry.arguments_masked.self).toBe('[Circular]');
    expect(entry.arguments_masked.nested.parent).toBe('[Circular]');
    expect(() => grimdall.auditTrail.verify()).not.toThrow();
  });
});
