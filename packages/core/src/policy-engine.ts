import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectInjections } from './injection-detector.js';
import { safeStringify } from './safe-json.js';
import {
  sendSlackAlert,
  type SendSlackAlertInput,
  type SlackAlertAuditEvent,
  type SlackAlertResult,
} from './slack-alert.js';
import type { Decision, Policy, ToolCall } from './types.js';

export interface PolicyEngineOptions {
  workspacePath?: string;
  policies?: Policy[];
  slackWebhookUrl?: string;
  agentId?: string;
  mode?: 'audit' | 'enforce';
  alertSender?: (input: SendSlackAlertInput) => Promise<SlackAlertResult>;
  alertLogger?: (event: SlackAlertAuditEvent) => void;
}

export class PolicyEngine {
  private policies: Policy[];
  private readonly workspacePath?: string;
  private readonly options: PolicyEngineOptions;
  private readonly mode: 'audit' | 'enforce';

  constructor(workspacePathOrPolicies: string | Policy[] = [], options: PolicyEngineOptions = {}) {
    const resolvedWorkspacePath =
      typeof workspacePathOrPolicies === 'string' ? workspacePathOrPolicies : options.workspacePath;
    const loadedPolicies =
      typeof workspacePathOrPolicies === 'string'
        ? loadPoliciesFromWorkspace(workspacePathOrPolicies)
        : workspacePathOrPolicies;

    this.workspacePath = resolvedWorkspacePath;
    this.policies = options.policies ?? loadedPolicies;
    this.options = options;
    this.mode = options.mode ?? 'enforce';
  }

  getMode(): 'audit' | 'enforce' {
    return this.mode;
  }

  addPolicy(policy: Policy): void {
    this.policies.push(policy);
  }

  getPolicies(): Policy[] {
    return this.policies;
  }

  reloadPolicies(): void {
    if (!this.workspacePath) {
      return;
    }

    this.policies = loadPoliciesFromWorkspace(this.workspacePath);
  }

  evaluate(toolCall: ToolCall): Decision {
    const risk = detectInjections(safeStringify(toolCall.arguments ?? {}));
    if (risk.risk_score > 75) {
      const decision: Decision = {
        status: this.mode === 'audit' ? 'would_block' : 'blocked',
        reason: 'Injection detected',
        policy_matched: 'prompt-injection-scan',
      };
      if (decision.status === 'blocked') {
        queueMicrotask(() => {
          void this.sendBlockedActionAlert(toolCall, decision);
        });
      }
      return decision;
    }

    for (const policy of this.policies) {
      if (!this.matchesTool(policy, toolCall.tool)) {
        continue;
      }
      if (!this.matchesCondition(policy, toolCall.arguments)) {
        continue;
      }
      if (policy.action === 'allow') {
        return { status: 'allowed', policy_matched: policy.id };
      }
      if (policy.action === 'block') {
        const status = this.mode === 'audit' ? 'would_block' : 'blocked';
        const decision: Decision = {
          status,
          reason: `Blocked by policy "${policy.id}"`,
          policy_matched: policy.id,
        };
        if (status === 'blocked') {
          queueMicrotask(() => {
            void this.sendBlockedActionAlert(toolCall, decision);
          });
        }
        return decision;
      }
      if (this.mode === 'audit') {
        return {
          status: 'would_block',
          reason: `Flagged for review by policy "${policy.id}"`,
          policy_matched: policy.id,
        };
      }
      return {
        status: 'review',
        reason: `Flagged for review by policy "${policy.id}"`,
        policy_matched: policy.id,
      };
    }

    return { status: 'allowed' };
  }

  private async sendBlockedActionAlert(toolCall: ToolCall, decision: Decision): Promise<void> {
    const sender = this.options.alertSender ?? sendSlackAlert;
    await sender({
      tool: toolCall.tool,
      reason: decision.reason ?? 'Blocked by policy',
      agentId: this.options.agentId ?? String(toolCall.context?.agent_id ?? 'unknown'),
      timestamp: new Date().toISOString(),
      webhookUrl: this.options.slackWebhookUrl,
      auditLogger: this.options.alertLogger,
    });
  }

  private matchesTool(policy: Policy, tool: string): boolean {
    return policy.tool === '*' || policy.tool === tool;
  }

  private matchesCondition(policy: Policy, args: Record<string, any>): boolean {
    if (!policy.condition || policy.condition === 'always') {
      return true;
    }
    if (policy.condition === 'arg_equals') {
      return anyValueMatches(args, policy.value, 'equals');
    }
    if (policy.condition === 'arg_contains') {
      return anyValueMatches(args, policy.value, 'contains');
    }
    return false;
  }
}

function anyValueMatches(value: any, target: any, mode: 'equals' | 'contains'): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => anyValueMatches(item, target, mode));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) => anyValueMatches(item, target, mode));
  }
  if (mode === 'equals') {
    return value === target;
  }
  return String(value).includes(String(target));
}

function loadPoliciesFromWorkspace(workspacePath: string): Policy[] {
  const policiesPath = join(workspacePath, 'policies.json');

  if (!existsSync(policiesPath)) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(policiesPath, 'utf8'));
    return Array.isArray(parsed) ? (parsed as Policy[]) : [];
  } catch {
    return [];
  }
}
