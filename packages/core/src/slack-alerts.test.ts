import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { postMessage, webClientConstructor } = vi.hoisted(() => ({
  postMessage: vi.fn(),
  webClientConstructor: vi.fn(() => {
    return {
      chat: {
        postMessage,
      },
    };
  }),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: webClientConstructor,
}));

import { sendApprovalRequest } from './slack-alerts';

describe('sendApprovalRequest', () => {
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_CHANNEL_ID = 'C0123456789';
    postMessage.mockReset();
    webClientConstructor.mockClear();
  });

  afterEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    vi.clearAllMocks();
  });

  it('posts a Block Kit approval request', async () => {
    await sendApprovalRequest({
      toolCall: {
        tool: 'runShell',
        arguments: {
          command: 'rm -rf /tmp/test',
        },
      } as never,
      reviewId: 'review-123',
    });

    expect(webClientConstructor).toHaveBeenCalledWith('xoxb-test-token');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C0123456789',
      text: '[REVIEW REQUIRED] Agent action blocked',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Action Requires Approval*\n*Tool:* `runShell`\n*Args:* ```{"command":"rm -rf /tmp/test"}```',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Approve',
              },
              style: 'primary',
              action_id: 'approve_action',
              value: 'review-123',
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Deny',
              },
              style: 'danger',
              action_id: 'deny_action',
              value: 'review-123',
            },
          ],
        },
      ],
    });
  });

  it('throws a clear error when the bot token is missing', async () => {
    delete process.env.SLACK_BOT_TOKEN;

    await expect(
      sendApprovalRequest({
        toolCall: {
          tool: 'runShell',
          arguments: {},
        } as never,
        reviewId: 'review-123',
      }),
    ).rejects.toThrow('SLACK_BOT_TOKEN environment variable is required');
  });

  it('masks secrets before posting arguments to Slack', async () => {
    await sendApprovalRequest({
      toolCall: {
        tool: 'callApi',
        arguments: {
          apiKey: 'sk-' + 'a'.repeat(48),
          headers: { authorization: 'Bearer secret.token' },
        },
      } as never,
      reviewId: 'review-456',
    });

    const posted = postMessage.mock.calls[0][0];
    const serialized = JSON.stringify(posted);
    expect(serialized).toContain('[REDACTED_OPENAI_KEY]');
    expect(serialized).toContain('Bearer [REDACTED]');
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('secret.token');
  });
});
