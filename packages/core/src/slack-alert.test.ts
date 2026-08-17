import { describe, expect, it, vi } from 'vitest';
import { sendSlackAlert } from './slack-alert';

describe('sendSlackAlert', () => {
  it('posts a blocked-action alert payload', async () => {
    const post = vi.fn(async () => ({ status: 200 }));
    const auditLogger = vi.fn();

    const result = await sendSlackAlert({
      tool: 'runShell',
      reason: 'Destructive shell command detected',
      agentId: 'agent-123',
      timestamp: '2026-08-01T12:00:00.000Z',
      webhookUrl: 'https://hooks.slack.com/services/test',
      post,
      auditLogger,
    });

    expect(result.status).toBe('sent');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('https://hooks.slack.com/services/test', {
      text: '[BLOCKED] Agent: agent-123 | Tool: runShell | Risk: [high] | Reason: [Destructive shell command detected]',
    });
    expect(auditLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        tool: 'runShell',
        agentId: 'agent-123',
        risk: 'high',
      }),
    );
  });

  it('retries failed slack calls before giving up', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValueOnce({ status: 200 });
    const sleep = vi.fn(async () => undefined);
    const auditLogger = vi.fn();

    const result = await sendSlackAlert({
      tool: 'dropTable',
      reason: 'DROP TABLE detected',
      agentId: 'agent-9',
      timestamp: '2026-08-01T12:00:00.000Z',
      webhookUrl: 'https://hooks.slack.com/services/test',
      post,
      sleep,
      auditLogger,
    });

    expect(result.status).toBe('sent');
    expect(result.attempts).toBe(3);
    expect(post).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(auditLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        attempts: 3,
      }),
    );
  });

  it('skips cleanly when no webhook URL is configured', async () => {
    const auditLogger = vi.fn();

    const result = await sendSlackAlert({
      tool: 'runShell',
      reason: 'Destructive shell command detected',
      agentId: 'agent-123',
      timestamp: '2026-08-01T12:00:00.000Z',
      webhookUrl: undefined,
      auditLogger,
    });

    expect(result.status).toBe('skipped');
    expect(result.error).toBe('Slack webhook URL is not configured');
    expect(auditLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        attempts: 0,
      }),
    );
  });
});
