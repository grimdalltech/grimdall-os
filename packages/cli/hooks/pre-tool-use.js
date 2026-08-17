#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9]{16,}/g, '[REDACTED_KEY]'],
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS]'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED_GH]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, '[REDACTED_BEARER]'],
];

const INJECTION_PATTERNS = [
  [/(rm\s+-rf|mkfs|dd\s+if=|:\(\)\{:\|:&\};:)/gi, 50],
  [/(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UNION\s+SELECT)/gi, 50],
  [/\.\.[/\\]/g, 25],
];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--agent') {
      options.agent = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--project') {
      options.project = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function mask(value) {
  if (typeof value === 'string') {
    let output = value;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
      output = output.replace(pattern, replacement);
    }
    return output;
  }
  if (Array.isArray(value)) {
    return value.map(mask);
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = mask(value[key]);
    }
    return result;
  }
  return value;
}

function loadJson(filePath, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : (parsed ?? fallback);
  } catch {
    return fallback;
  }
}

function anyValue(value, test) {
  if (Array.isArray(value)) {
    return value.some((item) => anyValue(item, test));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) => anyValue(item, test));
  }
  return test(value);
}

function matchesPolicy(policy, tool, args) {
  if (policy.tool !== '*' && policy.tool !== tool) {
    return false;
  }
  const condition = policy.condition ?? 'always';
  if (condition === 'always') {
    return true;
  }
  if (condition === 'arg_equals') {
    return anyValue(args, (value) => value === policy.value);
  }
  if (condition === 'arg_contains') {
    return anyValue(args, (value) => String(value).includes(String(policy.value)));
  }
  return false;
}

function sha256(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function readMode(projectDir) {
  try {
    const config = JSON.parse(readFileSync(join(projectDir, '.grimdall', 'config.json'), 'utf8'));
    return config.mode === 'audit' ? 'audit' : 'enforce';
  } catch {
    return 'enforce';
  }
}

function riskScore(input) {
  let score = 0;
  for (const [pattern, points] of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(input)) !== null) {
      score += points;
      if (pattern.lastIndex === match.index) {
        pattern.lastIndex += 1;
      }
    }
  }
  return score;
}

function appendAudit(projectDir, entry) {
  const auditPath = join(projectDir, '.grimdall', 'audit.json');
  const entries = loadJson(auditPath, []);
  const previousHash = entries.length > 0 ? entries[entries.length - 1].current_hash : 'GENESIS';
  const payload = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    tool: entry.tool,
    arguments_masked: entry.arguments_masked,
    decision: entry.decision,
    reason: entry.reason,
    policy_matched: entry.policy_matched,
  });
  const currentHash = sha256(payload + previousHash);
  entries.push({
    id: entry.id,
    timestamp: entry.timestamp,
    tool: entry.tool,
    arguments_masked: entry.arguments_masked,
    decision: entry.decision,
    reason: entry.reason,
    policy_matched: entry.policy_matched,
    previous_hash: previousHash,
    current_hash: currentHash,
  });
  mkdirSync(dirname(auditPath), { recursive: true });
  writeFileSync(auditPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const agent = options.agent ?? 'claude';
  const projectDir = options.project ?? process.cwd();

  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    input = {};
  }

  const toolName = input.tool_name ?? input.tool ?? 'unknown';
  const rawArguments = input.tool_input ?? input.arguments ?? {};
  const argsRecord =
    typeof rawArguments === 'object' && rawArguments !== null && !Array.isArray(rawArguments)
      ? rawArguments
      : { args: rawArguments };

  const mode = readMode(projectDir);
  const policies = loadJson(join(projectDir, '.grimdall', 'policies.json'), []);
  let decision = 'allow';
  let reason = 'Allowed by policy';
  let policyMatched;

  if (riskScore(JSON.stringify(argsRecord)) > 75) {
    decision = mode === 'audit' ? 'would_block' : 'block';
    reason = 'Injection detected';
    policyMatched = 'prompt-injection-scan';
  } else {
    for (const policy of policies) {
      if (!matchesPolicy(policy, toolName, argsRecord)) {
        continue;
      }
      if (policy.action === 'allow') {
        decision = 'allow';
        reason = `Allowed by policy "${policy.id}"`;
        policyMatched = policy.id;
        break;
      }
      if (policy.action === 'block') {
        decision = mode === 'audit' ? 'would_block' : 'block';
        reason = `Blocked by policy "${policy.id}"`;
        policyMatched = policy.id;
        break;
      }
      decision = 'allow';
      reason = `Flagged for review by policy "${policy.id}" (proceeding)`;
      policyMatched = policy.id;
      break;
    }
  }
  if (decision === 'would_block') {
    reason = `${reason} (audit mode: recorded, not blocked)`;
  }

  const timestamp = new Date().toISOString();
  const id = sha256(timestamp + toolName + JSON.stringify(argsRecord));
  appendAudit(projectDir, {
    id,
    timestamp,
    tool: toolName,
    arguments_masked: mask(argsRecord),
    decision: decision === 'allow' ? 'allowed' : decision === 'block' ? 'blocked' : 'would_block',
    reason,
    policy_matched: policyMatched,
  });

  let output;
  if (agent === 'codex') {
    output = {
      decision: decision === 'block' ? 'block' : 'allow',
      explanation: reason,
    };
  } else {
    output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision === 'block' ? 'deny' : 'allow',
        permissionDecisionReason: reason,
        suppressOutput: true,
      },
    };
  }
  process.stdout.write(JSON.stringify(output) + '\n');
}

main();
