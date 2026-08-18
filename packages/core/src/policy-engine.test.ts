import { describe, expect, it, vi } from 'vitest';
import { PolicyEngine } from './policy-engine';

function makeAlertSender() {
  return vi.fn(async () => ({ status: 'sent' as const, attempts: 1 }));
}

describe('PolicyEngine', () => {
  it('allows by default when no policy matches', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({ tool: 'anyTool', arguments: { x: 1 } });
    expect(decision.status).toBe('allowed');
  });

  it('blocks when an injection exceeds the risk threshold', async () => {
    const alertSender = makeAlertSender();
    const engine = new PolicyEngine([], {
      slackWebhookUrl: 'https://example.com/webhook',
      alertSender,
    });
    const decision = engine.evaluate({
      tool: 'runShell',
      arguments: { cmd: 'rm -rf / && DROP TABLE users' },
    });
    expect(decision.status).toBe('blocked');
    expect(decision.reason).toBe('Injection detected');
    await Promise.resolve();
    expect(alertSender).toHaveBeenCalledTimes(1);
  });

  it('does not let the injection blocker fire for a single pattern at or below threshold', () => {
    const engine = new PolicyEngine([
      { id: 'allow', tool: '*', action: 'allow', condition: 'always' },
    ]);
    const decision = engine.evaluate({ tool: 'runShell', arguments: { cmd: 'rm -rf /' } });
    expect(decision.status).toBe('allowed');
  });

  it('matches wildcard policies with arg_contains', async () => {
    const alertSender = makeAlertSender();
    const engine = new PolicyEngine(
      [{ id: 'block-rm', tool: '*', action: 'block', condition: 'arg_contains', value: 'rm -rf' }],
      {
        slackWebhookUrl: 'https://example.com/webhook',
        alertSender,
      },
    );
    const decision = engine.evaluate({ tool: 'runShell', arguments: { cmd: 'rm -rf /' } });
    expect(decision.status).toBe('blocked');
    expect(decision.policy_matched).toBe('block-rm');
    expect(decision.reason).toContain('block-rm');
    await Promise.resolve();
    expect(alertSender).toHaveBeenCalledTimes(1);
  });

  it('matches tool-specific policies with arg_equals', () => {
    const alertSender = makeAlertSender();
    const engine = new PolicyEngine(
      [
        {
          id: 'no-delete-config',
          tool: 'deleteFile',
          action: 'block',
          condition: 'arg_equals',
          value: 'config.json',
        },
      ],
      {
        slackWebhookUrl: 'https://example.com/webhook',
        alertSender,
      },
    );
    expect(engine.evaluate({ tool: 'deleteFile', arguments: { path: 'config.json' } }).status).toBe(
      'blocked',
    );
    expect(engine.evaluate({ tool: 'deleteFile', arguments: { path: 'readme.md' } }).status).toBe(
      'allowed',
    );
    expect(engine.evaluate({ tool: 'otherTool', arguments: { path: 'config.json' } }).status).toBe(
      'allowed',
    );
  });

  it('matches nested argument values', async () => {
    const alertSender = makeAlertSender();
    const engine = new PolicyEngine(
      [{ id: 'no-admin', tool: '*', action: 'block', condition: 'arg_equals', value: 'admin' }],
      {
        slackWebhookUrl: 'https://example.com/webhook',
        alertSender,
      },
    );
    const decision = engine.evaluate({ tool: 'login', arguments: { user: { role: 'admin' } } });
    expect(decision.status).toBe('blocked');
    await Promise.resolve();
    expect(alertSender).toHaveBeenCalledTimes(1);
  });

  it('returns review status when a review policy matches', () => {
    const engine = new PolicyEngine([
      { id: 'review-email', tool: '*', action: 'review', condition: 'always' },
    ]);
    const decision = engine.evaluate({ tool: 'sendEmail', arguments: {} });
    expect(decision.status).toBe('review');
    expect(decision.policy_matched).toBe('review-email');
  });

  it('applies the first matching policy', () => {
    const blockFirst = new PolicyEngine([
      { id: 'block', tool: '*', action: 'block', condition: 'always' },
      { id: 'allow', tool: 'ls', action: 'allow', condition: 'always' },
    ]);
    expect(blockFirst.evaluate({ tool: 'ls', arguments: {} }).status).toBe('blocked');

    const allowFirst = new PolicyEngine([
      { id: 'allow', tool: 'ls', action: 'allow', condition: 'always' },
      { id: 'block', tool: '*', action: 'block', condition: 'always' },
    ]);
    expect(allowFirst.evaluate({ tool: 'ls', arguments: {} }).status).toBe('allowed');
  });

  it('does not crash on circular arguments', () => {
    const circular: Record<string, any> = { cmd: 'echo hi' };
    circular.self = circular;
    const engine = new PolicyEngine();
    const decision = engine.evaluate({ tool: 'runShell', arguments: circular });
    expect(decision.status).toBe('allowed');
  });

  it('defaults to enforce mode', () => {
    const engine = new PolicyEngine();
    expect(engine.getMode()).toBe('enforce');
  });

  it('downgrades blocks to would_block in audit mode without alerting', async () => {
    const alertSender = makeAlertSender();
    const engine = new PolicyEngine(
      [{ id: 'block-rm', tool: '*', action: 'block', condition: 'arg_contains', value: 'rm -rf' }],
      {
        mode: 'audit',
        slackWebhookUrl: 'https://example.com/webhook',
        alertSender,
      },
    );
    const decision = engine.evaluate({ tool: 'runShell', arguments: { cmd: 'rm -rf /' } });
    expect(decision.status).toBe('would_block');
    expect(decision.policy_matched).toBe('block-rm');
    expect(engine.getMode()).toBe('audit');
    await Promise.resolve();
    expect(alertSender).not.toHaveBeenCalled();
  });

  it('downgrades review and injection decisions to would_block in audit mode', async () => {
    const engine = new PolicyEngine(
      [{ id: 'review-email', tool: '*', action: 'review', condition: 'always' }],
      { mode: 'audit' },
    );
    expect(engine.evaluate({ tool: 'sendEmail', arguments: {} }).status).toBe('would_block');

    const injectionDecision = engine.evaluate({
      tool: 'runShell',
      arguments: { cmd: 'rm -rf / && DROP TABLE users' },
    });
    expect(injectionDecision.status).toBe('would_block');
    expect(injectionDecision.policy_matched).toBe('prompt-injection-scan');
  });
});
