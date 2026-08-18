import { WebClient } from '@slack/web-api';
import { maskSecrets } from './secret-masking.js';
import { safeStringify } from './safe-json.js';
import type { ToolCall } from './types.js';

export interface SlackApprovalRequestTextObject {
  type: 'mrkdwn';
  text: string;
}

export interface SlackApprovalRequestSectionBlock {
  type: 'section';
  text: SlackApprovalRequestTextObject;
}

export interface SlackApprovalRequestButtonTextObject {
  type: 'plain_text';
  text: string;
}

export interface SlackApprovalRequestButton {
  type: 'button';
  text: SlackApprovalRequestButtonTextObject;
  style: 'primary' | 'danger';
  action_id: 'approve_action' | 'deny_action';
  value: string;
}

export interface SlackApprovalRequestActionsBlock {
  type: 'actions';
  elements: [SlackApprovalRequestButton, SlackApprovalRequestButton];
}

export interface SlackApprovalRequestMessage {
  channel: string;
  text: string;
  blocks: [SlackApprovalRequestSectionBlock, SlackApprovalRequestActionsBlock];
}

export interface SendApprovalRequestInput {
  toolCall: ToolCall;
  reviewId: string;
}

let slackClient: WebClient | undefined;

function getSlackClient(): WebClient {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    throw new Error('SLACK_BOT_TOKEN environment variable is required');
  }

  slackClient = slackClient ?? new WebClient(slackToken);
  return slackClient;
}

function getSlackChannel(): string {
  return process.env.SLACK_CHANNEL_ID || '#general';
}

export async function sendApprovalRequest({
  toolCall,
  reviewId,
}: SendApprovalRequestInput): Promise<void> {
  const message: SlackApprovalRequestMessage = {
    channel: getSlackChannel(),
    text: '[REVIEW REQUIRED] Agent action blocked',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Action Requires Approval*\n*Tool:* \`${toolCall.tool}\`\n*Args:* \`\`\`${safeStringify(
            maskSecrets(toolCall.arguments ?? {}),
          )}\`\`\``,
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
            value: reviewId,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Deny',
            },
            style: 'danger',
            action_id: 'deny_action',
            value: reviewId,
          },
        ],
      },
    ],
  };

  await getSlackClient().chat.postMessage(message);
}
