export const defaultPolicyRules: unknown[];

export function evaluatePolicy(
  tool: string,
  args?: Record<string, unknown>,
  rules?: unknown[],
  options?: {
    mode?: "audit" | "enforce";
    allowlistRules?: unknown[];
  },
): {
  status: string;
  reason?: string;
  rule_matched?: string;
  remediation?: string;
};

export function createAuditDecision(input: {
  timestamp: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: string;
  ruleMatched?: string;
  remediation?: string;
}): unknown;
