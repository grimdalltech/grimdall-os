import axios from 'axios';

export type SlackAlertOutcome = 'sent' | 'failed' | 'skipped';

export interface SlackAlertAuditEvent {
  status: SlackAlertOutcome;
  tool: string;
  agentId: string;
  risk: 'high';
  reason: string;
  alertMessage: string;
  timestamp: string;
  attempts: number;
  error?: string;
}

export interface SendSlackAlertInput {
  tool: string;
  reason: string;
  agentId?: string;
  timestamp: string;
  risk?: 'high';
  webhookUrl?: string;
  auditLogger?: (event: SlackAlertAuditEvent) => void;
  post?: typeof axios.post;
  sleep?: (ms: number) => Promise<void>;
  retryCount?: number;
  baseDelayMs?: number;
}

export interface SlackAlertResult {
  status: SlackAlertOutcome;
  attempts: number;
  alertMessage?: string;
  error?: string;
}

const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_BASE_DELAY_MS = 100;

export async function sendSlackAlert({
  tool,
  reason,
  agentId = 'unknown',
  timestamp,
  risk = 'high',
  webhookUrl = process.env.GRIMDALL_SLACK_WEBHOOK_URL,
  auditLogger,
  post = axios.post,
  sleep = defaultSleep,
  retryCount = DEFAULT_RETRY_COUNT,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
}: SendSlackAlertInput): Promise<SlackAlertResult> {
  const alertMessage = `[BLOCKED] Agent: ${agentId} | Tool: ${tool} | Risk: [${risk}] | Reason: [${reason}]`;

  if (!webhookUrl) {
    const result: SlackAlertResult = {
      status: 'skipped',
      attempts: 0,
      alertMessage,
      error: 'Slack webhook URL is not configured',
    };

    auditLogger?.({
      status: 'skipped',
      tool,
      agentId,
      risk,
      reason: 'Slack webhook URL is not configured',
      alertMessage,
      timestamp,
      attempts: 0,
      error: result.error,
    });

    return result;
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      await post(webhookUrl, { text: alertMessage });
      const result: SlackAlertResult = {
        status: 'sent',
        attempts: attempt,
        alertMessage,
      };

      auditLogger?.({
        status: 'sent',
        tool,
        agentId,
        risk,
        reason,
        alertMessage,
        timestamp,
        attempts: attempt,
      });

      return result;
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  const errorMessage = errorToMessage(lastError);
  const result: SlackAlertResult = {
    status: 'failed',
    attempts: retryCount,
    alertMessage,
    error: errorMessage,
  };

  auditLogger?.({
    status: 'failed',
    tool,
    agentId,
    risk,
    reason: errorMessage,
    alertMessage,
    timestamp,
    attempts: retryCount,
    error: errorMessage,
  });

  return result;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Slack webhook request failed';
}
