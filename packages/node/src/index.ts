import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  AuditTrail,
  DEFAULT_POLICIES,
  PolicyEngine,
  ReviewManager,
  maskSecrets,
  sendApprovalRequest,
} from 'grimdall-core';
import type {
  Decision,
  Policy,
  PolicyEngineOptions,
  SlackAlertAuditEvent,
  ToolCall,
} from 'grimdall-core';
import { startWebhookServer, type WebhookServerHandle } from './webhook-server.js';

export interface GrimdallConfig {
  workspaceId?: string;
  workspacePath?: string;
  workspaceRoot?: string;
  auditPath?: string;
  policies?: Policy[];
  slackWebhookUrl?: string;
  webhookPort?: number;
  reviewTimeoutMs?: number;
  agentId?: string;
  mode?: 'audit' | 'enforce';
  alertSender?: PolicyEngineOptions['alertSender'];
  projectDir?: string;
}

export interface Grimdall {
  auditTrail: AuditTrail;
  policyEngine: PolicyEngine;
  reviewManager: ReviewManager;
  webhookServer?: WebhookServerHandle;
  wrapTool<T extends (...args: any[]) => any>(fn: T, name: string): T;
}

export function createGrimdall(config: GrimdallConfig = {}): Grimdall {
  const zeroConfig =
    !config.workspacePath && !config.auditPath && !config.workspaceId && !config.workspaceRoot;
  const projectDir = resolve(config.projectDir ?? process.cwd());
  const workspacePath = resolveWorkspacePath(config, projectDir);

  if (zeroConfig) {
    ensureDotGrimdall(workspacePath);
  }
  if (!existsSync(workspacePath)) {
    throw new Error(`Workspace "${workspacePath}" does not exist. Create it with the CLI first.`);
  }

  const auditTrail = config.auditPath
    ? new AuditTrail(config.auditPath)
    : new AuditTrail(workspacePath);
  const reviewManager = new ReviewManager(join(workspacePath, 'pending-reviews.json'));
  const globalConfig = zeroConfig ? readGlobalConfig(workspacePath) : undefined;
  const resolvedMode: 'audit' | 'enforce' | undefined =
    config.mode ?? globalConfig?.mode ?? undefined;
  const policyEngine = new PolicyEngine(workspacePath, {
    workspacePath,
    policies: config.policies,
    mode: resolvedMode,
    slackWebhookUrl:
      config.slackWebhookUrl ??
      process.env.GRIMDALL_SLACK_WEBHOOK_URL ??
      (isUsableWebhookUrl(globalConfig?.SLACK_WEBHOOK_URL)
        ? globalConfig?.SLACK_WEBHOOK_URL
        : undefined),
    agentId: config.agentId,
    alertSender: config.alertSender,
    alertLogger: (event) => recordSlackAlertAuditEvent(auditTrail, event),
  });

  const webhookPort = config.webhookPort ?? resolveWebhookPort(globalConfig?.WEBHOOK_PORT);
  let webhookServer: WebhookServerHandle | undefined;

  const reviewTimeoutMs = config.reviewTimeoutMs ?? 5 * 60 * 1000;
  const cleanupTimer = setInterval(() => {
    reviewManager.cleanupExpiredReviews(reviewTimeoutMs);
  }, reviewTimeoutMs);
  cleanupTimer.unref?.();

  function wrapTool<T extends (...args: any[]) => any>(fn: T, name: string): T {
    const wrapped = (...args: any[]): any => {
      const argumentsRecord = args.length === 1 && isPlainObject(args[0]) ? args[0] : { args };
      const masked = maskSecrets(argumentsRecord);
      const toolCall: ToolCall = {
        tool: name,
        arguments: argumentsRecord,
        context: {
          agent_id: config.agentId,
          workspace_id: workspaceIdFromPath(workspacePath),
        },
      };
      const decision = policyEngine.evaluate(toolCall);

      if (decision.status === 'blocked') {
        auditTrail.addEntry({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          tool: name,
          arguments_masked: masked,
          decision: 'blocked',
          reason: decision.reason,
          policy_matched: decision.policy_matched,
        });
        throw new Error(
          `[BLOCKED] Tool "${name}" rejected: ${decision.reason ?? 'no matching policy allows this call'}`,
        );
      }

      if (decision.status === 'would_block') {
        auditTrail.addEntry({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          tool: name,
          arguments_masked: masked,
          decision: 'would_block',
          reason: decision.reason,
          policy_matched: decision.policy_matched,
        });
        return fn(...args);
      }

      if (decision.status === 'review' && hasSlackHitlConfiguration()) {
        webhookServer = webhookServer ?? startWebhookServer(reviewManager, webhookPort);
        return handleHumanReview({
          fn,
          args,
          toolCall,
          masked,
          decision,
          reviewManager,
          auditTrail,
          reviewTimeoutMs,
        });
      }

      auditTrail.addEntry({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        tool: name,
        arguments_masked: masked,
        decision: decision.status,
        policy_matched: decision.policy_matched,
      });

      return fn(...args);
    };

    return wrapped as T;
  }

  return { auditTrail, policyEngine, reviewManager, webhookServer, wrapTool };
}

function resolveWorkspacePath(config: GrimdallConfig, projectDir: string): string {
  if (config.workspacePath) {
    return resolve(config.workspacePath);
  }

  if (config.auditPath) {
    return resolve(dirname(config.auditPath));
  }

  if (config.workspaceId || config.workspaceRoot) {
    const workspaceRoot = resolve(config.workspaceRoot ?? process.cwd(), 'workspaces');
    const workspaceId = config.workspaceId ?? 'default';
    return join(workspaceRoot, workspaceId);
  }

  return join(projectDir, '.grimdall');
}

function ensureDotGrimdall(workspacePath: string): void {
  mkdirSync(workspacePath, { recursive: true });

  const configPath = join(workspacePath, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          version: 1,
          SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
          WEBHOOK_PORT: 3001,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  }

  const policiesPath = join(workspacePath, 'policies.json');
  if (!existsSync(policiesPath)) {
    writeFileSync(policiesPath, JSON.stringify(DEFAULT_POLICIES, null, 2) + '\n', 'utf8');
  }

  const auditPath = join(workspacePath, 'audit.json');
  if (!existsSync(auditPath)) {
    writeFileSync(auditPath, JSON.stringify([], null, 2) + '\n', 'utf8');
  }
}

function readGlobalConfig(
  workspacePath: string,
): { SLACK_WEBHOOK_URL?: string; WEBHOOK_PORT?: number; mode?: 'audit' | 'enforce' } | undefined {
  const configPath = join(workspacePath, 'config.json');
  if (!existsSync(configPath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      SLACK_WEBHOOK_URL?: string;
      WEBHOOK_PORT?: number;
      mode?: 'audit' | 'enforce';
    };
    return parsed;
  } catch {
    return undefined;
  }
}

function isUsableWebhookUrl(url: string | undefined): boolean {
  return Boolean(url && !url.includes('YOUR') && !url.includes('hooks.slack.com/services/YOUR'));
}

async function handleHumanReview<T>({
  fn,
  args,
  toolCall,
  masked,
  decision,
  reviewManager,
  auditTrail,
  reviewTimeoutMs,
}: {
  fn: (...args: any[]) => T;
  args: any[];
  toolCall: ToolCall;
  masked: any;
  decision: Decision;
  reviewManager: ReviewManager;
  auditTrail: AuditTrail;
  reviewTimeoutMs: number;
}): Promise<T> {
  const reviewId = randomUUID();

  const approvalPromise = new Promise<'approve' | 'deny'>((resolve, reject) => {
    reviewManager.addPendingReview({
      reviewId,
      toolCall,
      resolve,
      reject,
      timestamp: Date.now(),
    });
  });
  approvalPromise.catch(() => undefined);

  try {
    await sendApprovalRequest({ toolCall, reviewId });
  } catch (error) {
    reviewManager.resolveReview(reviewId, 'deny');
    auditTrail.addEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      tool: toolCall.tool,
      arguments_masked: masked,
      decision: 'blocked',
      reason: `Failed to send approval request: ${(error as Error).message}`,
      policy_matched: decision.policy_matched,
    });
    throw error;
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<'deny'>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reviewManager.resolveReview(reviewId, 'deny');
      reject(new Error(`Review timed out after ${reviewTimeoutMs}ms`));
    }, reviewTimeoutMs);
  });

  try {
    const result = await Promise.race([approvalPromise, timeoutPromise]);
    if (result !== 'approve') {
      throw new Error(`Review denied for ${toolCall.tool}`);
    }

    auditTrail.addEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      tool: toolCall.tool,
      arguments_masked: masked,
      decision: 'allowed',
      reason: 'Approved by human review',
      policy_matched: decision.policy_matched,
    });

    return fn(...args);
  } catch (error) {
    auditTrail.addEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      tool: toolCall.tool,
      arguments_masked: masked,
      decision: 'blocked',
      reason: (error as Error).message,
      policy_matched: decision.policy_matched,
    });
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workspaceIdFromPath(workspacePath: string): string {
  return workspacePath.split(/[/\\]/).filter(Boolean).at(-1) ?? 'default';
}

function recordSlackAlertAuditEvent(auditTrail: AuditTrail, event: SlackAlertAuditEvent): void {
  auditTrail.addEntry({
    id: randomUUID(),
    timestamp: event.timestamp,
    tool: 'slack_alert',
    arguments_masked: {
      tool: event.tool,
      agent_id: event.agentId,
      risk: event.risk,
      alert_message: event.alertMessage,
      attempts: event.attempts,
      status: event.status,
    },
    decision: event.status,
    reason: event.error ?? event.reason,
    policy_matched: event.tool,
  });
}

function hasSlackHitlConfiguration(): boolean {
  return Boolean(
    process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID && process.env.SLACK_SIGNING_SECRET,
  );
}

function resolveWebhookPort(configuredPort?: number): number {
  if (configuredPort) {
    return configuredPort;
  }
  const portValue = process.env.WEBHOOK_PORT;
  if (!portValue) {
    return 3001;
  }

  const parsed = Number(portValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3001;
}
