#!/usr/bin/env node
"use strict";
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9]{16,}/g, "[REDACTED_KEY]"],
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS]"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED_GH]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "[REDACTED_BEARER]"],
];

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+(?:\/(?:\s|$)|\/\*|~|\*|\$HOME|\.\s*$|[a-zA-Z]:[\\/])/i,
  /\bRemove-Item\s+.*-([Rr]ecurse|[Ff]orce)\b/i,
  /\brmdir\s+\/s/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(?:\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /fork\s+bomb/i,
];

const SHELL_TOOLS = new Set([
  "shell_execute",
  "shell_command",
  "terminal_command",
  "shell",
  "bash",
  "runShell",
  "execute_shell",
]);

function mask(value) {
  if (typeof value === "string") {
    let output = value;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
      output = output.replace(pattern, replacement);
    }
    return output;
  }
  if (Array.isArray(value)) return value.map(mask);
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value)) result[key] = mask(value[key]);
    return result;
  }
  return value;
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function sha256(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function shellBlockReason(args) {
  const command = String(args.command ?? args.cmd ?? args.script ?? "");
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return "Destructive shell command detected";
  }
  return null;
}

function databaseBlockReason(args) {
  const query = String(args.query ?? args.sql ?? "");
  if (/(drop\s+table|drop\s+database|truncate|delete\s+from)/i.test(query)) {
    return "Destructive database operation blocked";
  }
  return null;
}

function matchesConfigPolicy(policies, tool, args) {
  for (const policy of policies) {
    if (policy.tool !== tool && policy.tool !== "*") continue;
    if (policy.action !== "block" && policy.action !== "block_and_alert") continue;
    if (policy.condition === "block_always") return true;
    if (policy.condition === "arg_contains") {
      const field = policy.field || "command";
      const target = String(args[field] ?? "");
      return policy.keywords.some((k) => target.toLowerCase().includes(String(k).toLowerCase()));
    }
  }
  return false;
}

function main() {
  const options = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--agent") options.agent = argv[i + 1];
    if (argv[i] === "--project") options.project = argv[i + 1];
  }
  const projectDir = options.project ?? process.cwd();

  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    input = {};
  }
  const toolName = input.tool_name ?? input.tool ?? "unknown";
  const rawArgs = input.tool_input ?? input.arguments ?? {};
  const args =
    typeof rawArgs === "object" && rawArgs !== null
      ? rawArgs
      : { args: rawArgs };

  const config = loadJson(join(projectDir, "grimdall.config.json"), {
    policies: [],
  });
  const policies = Array.isArray(config.policies) ? config.policies : [];

  let reason = null;
  if (SHELL_TOOLS.has(toolName)) reason = shellBlockReason(args);
  if (!reason && /database/i.test(toolName)) reason = databaseBlockReason(args);
  if (!reason) reason = matchesConfigPolicy(policies, toolName, args)
    ? "Blocked by Grimdall policy"
    : null;

  const decision = reason ? "block" : "allow";
  const decisionReason = finalReason(reason, args);

  const timestamp = new Date().toISOString();
  const masked = mask(args);
  const id = sha256(timestamp + toolName + JSON.stringify(masked));
  const previous = loadJson(join(projectDir, ".grimdall", "audit.json"), []);
  const previousHash =
    previous.length > 0 ? previous[previous.length - 1].current_hash : "GENESIS";
  const entry = {
    id,
    timestamp,
    tool: toolName,
    arguments_masked: masked,
    decision: decision === "block" ? "blocked" : "allowed",
    reason: decisionReason,
    policy_matched: null,
    previous_hash: previousHash,
    current_hash: sha256(
      JSON.stringify({
        id,
        timestamp,
        tool: toolName,
        arguments_masked: masked,
        decision,
        reason: decisionReason,
      }) + previousHash
    ),
  };
  const auditPath = join(projectDir, ".grimdall", "audit.json");
  mkdirSync(dirname(auditPath), { recursive: true });
  writeFileSync(
    auditPath,
    JSON.stringify([...previous, entry], null, 2) + "\n",
    "utf8"
  );

  let output;
  if (options.agent === "codex") {
    output = { decision, explanation: entry.reason };
  } else {
    output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: entry.reason,
        suppressOutput: true,
      },
    };
  }
  process.stdout.write(JSON.stringify(output) + "\n");
}

function finalReason(blockedReason, args) {
  const command = String(args.command ?? args.cmd ?? "");
  if (blockedReason && command) return `${blockedReason}: ${command}`;
  return blockedReason ?? "Allowed by policy";
}

main();