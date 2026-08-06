import { isAllowlisted, loadAllowlistRulesFromConfig } from "./allowlist.js";
import { getGrimdallMode, loadGrimdallConfig } from "./grimdall-config.js";
import { suggestRemediation } from "./remediation-engine.js";

export const defaultPolicyRules = [
  {
    tool: "github_delete_repo",
    condition: "block_always",
    action: "block_and_alert",
    message: "Repository deletion is globally blocked by policy.",
  },
  {
    tool: "shell_execute",
    condition: "arg_matches",
    field: "command",
    pattern:
      /rm\s+-rf\s+(?:\/|~|\*|\$HOME|\.\s*$)|chmod\s+777|mkfs|dd\s+if=|:\(\)\{\s*:\|:&\s*\};:/i,
    action: "block_and_alert",
    message: "Destructive shell command detected.",
  },
  {
    tool: "database_execute",
    condition: "arg_contains",
    field: "query",
    keywords: ["DROP TABLE", "DROP DATABASE", "TRUNCATE", "DELETE FROM"],
    action: "block_and_alert",
    message: "Destructive database operation blocked.",
  },
  {
    tool: "stripe_create_refund",
    condition: "arg_less_than",
    field: "amount",
    threshold: 5000,
    action: "block_and_alert",
    message: "Refund exceeds $50.00 policy limit.",
  },
  {
    tool: "deploy_production",
    condition: "require_review",
    action: "require_review",
    message: "Production deployments require human approval.",
  },
];

function getRuleId(rule) {
  return rule.id || rule.name || rule.tool;
}

function readArgument(args, field) {
  if (!field || !args || typeof args !== "object") return undefined;
  return String(field)
    .split(".")
    .reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), args);
}

function numberValue(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function conditionMatches(rule, args) {
  switch (rule.condition) {
    case "allow_always":
    case "block_always":
    case "require_review":
      return true;

    case "arg_matches": {
      const value = readArgument(args, rule.field);
      const pattern =
        rule.pattern instanceof RegExp
          ? rule.pattern
          : typeof rule.pattern === "string" && rule.pattern.trim()
            ? new RegExp(rule.pattern, "i")
            : null;

      return typeof value === "string" && pattern ? pattern.test(value) : false;
    }

    case "arg_less_than": {
      const value = numberValue(readArgument(args, rule.field));
      const threshold = numberValue(rule.threshold);
      return value !== undefined && threshold !== undefined && value > threshold;
    }

    case "arg_greater_than": {
      const value = numberValue(readArgument(args, rule.field));
      const threshold = numberValue(rule.threshold);
      return value !== undefined && threshold !== undefined && value < threshold;
    }

    case "arg_equals":
      return readArgument(args, rule.field) === rule.value;

    case "arg_contains": {
      const value = readArgument(args, rule.field);
      if (typeof value !== "string" || !Array.isArray(rule.keywords)) return false;
      const normalized = value.toLowerCase();
      return rule.keywords.some((keyword) =>
        normalized.includes(String(keyword).toLowerCase())
      );
    }

    default:
      return false;
  }
}

function getAuditMode(options) {
  if (options && typeof options.mode === "string") {
    return options.mode.toLowerCase() === "enforce" ? "enforce" : "audit";
  }

  return loadGrimdallConfig().mode ?? getGrimdallMode();
}

export function evaluatePolicy(tool, args = {}, rules = defaultPolicyRules, options = {}) {
  const allowlistRules =
    options.allowlistRules ?? loadAllowlistRulesFromConfig();
  const mode = getAuditMode(options);

  if (isAllowlisted(tool, args, allowlistRules)) {
    return { status: "allowed", reason: "allowlisted" };
  }

  const matchingRules = Array.isArray(rules)
    ? rules.filter((rule) => rule && rule.tool === tool)
    : [];

  for (const rule of matchingRules) {
    if (!conditionMatches(rule, args)) continue;

    if (rule.condition === "allow_always") {
      return { status: "allowed" };
    }

    if (rule.condition === "require_review" || rule.action === "require_review") {
      return {
        status: mode === "audit" ? "would_block" : "review",
        reason: rule.message || "This action requires human review.",
        rule_matched: getRuleId(rule),
        remediation: suggestRemediation(tool, args),
      };
    }

    return {
      status: mode === "audit" ? "would_block" : "blocked",
      reason:
        mode === "audit"
          ? rule.message || "Would be blocked by Grimdall policy."
          : rule.message || "Blocked by Grimdall policy.",
      rule_matched: getRuleId(rule),
      remediation: suggestRemediation(tool, args),
    };
  }

  return { status: "allowed" };
}

export function createAuditDecision({
  timestamp,
  tool,
  arguments: args,
  status,
  ruleMatched,
  remediation,
}) {
  return {
    timestamp,
    tool,
    arguments: args,
    status,
    rule_matched: ruleMatched,
    remediation,
  };
}
