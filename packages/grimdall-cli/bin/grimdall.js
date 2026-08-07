#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { cwd, env, exit, stdin, stdout } from "node:process";

const VERSION = "0.3.2";

const DEFAULT_ENDPOINT = process.env.GRIMDALL_ENDPOINT ?? "";

const args = process.argv.slice(2);
const command = args[0];

function readFlag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function detectStack(root) {
  const stacks = [];

  if (existsSync(join(root, "package.json"))) stacks.push("node");
  if (existsSync(join(root, "requirements.txt")) || existsSync(join(root, "pyproject.toml"))) {
    stacks.push("python");
  }
  if (existsSync(join(root, "pom.xml")) || existsSync(join(root, "build.gradle"))) {
    stacks.push("java");
  }

  return stacks.length ? stacks : ["custom"];
}

function writeFileIfSafe(path, content, force, dryRun) {
  if (existsSync(path) && !force) {
    return { path, status: "skipped" };
  }

  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  return { path, status: dryRun ? "would write" : "written" };
}

function getProjectName(root) {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return "my-agent";

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    return packageJson.name || "my-agent";
  } catch {
    return "my-agent";
  }
}

async function askSetupQuestions(detectedStack, endpoint, apiKeyEnv) {
  if (hasFlag("yes") || !stdin.isTTY || !stdout.isTTY) {
    return {
      stack: readFlag("stack", detectedStack),
      endpoint,
      apiKeyEnv,
    };
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const stack =
      (await rl.question(`Stack (${detectedStack}): `)).trim() || detectedStack;
    const chosenEndpoint =
      (await rl.question(`Grimdall endpoint (${endpoint}): `)).trim() || endpoint;
    const chosenApiKeyEnv =
      (await rl.question(`API key env var (${apiKeyEnv}): `)).trim() ||
      apiKeyEnv;

    return {
      stack,
      endpoint: chosenEndpoint,
      apiKeyEnv: chosenApiKeyEnv,
    };
  } finally {
    rl.close();
  }
}

async function init() {
  const root = cwd();
  const dryRun = hasFlag("dry-run");
  const force = hasFlag("force");
  const detectedStack = detectStack(root).join(",");
  const initialEndpoint = readFlag("endpoint", env.GRIMDALL_ENDPOINT || DEFAULT_ENDPOINT);
  const initialApiKeyEnv = readFlag("api-key-env", "GRIMDALL_API_KEY");
  const answers = await askSetupQuestions(
    readFlag("stack", detectedStack),
    initialEndpoint,
    initialApiKeyEnv
  );
  const stack = answers.stack;
  const endpoint = answers.endpoint;
  const apiKeyEnv = answers.apiKeyEnv;
  const projectName = getProjectName(root);

  const config = `${JSON.stringify(
    {
      apiKey: "grimdall_sk_YOUR_KEY_HERE",
      endpoint,
      slackWebhookUrl: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
      policies: [
        {
          tool: "github_delete_repo",
          condition: "block_always",
          action: "block_and_alert",
          message: "Repository deletion is globally blocked.",
        },
        {
          tool: "shell_execute",
          condition: "arg_contains",
          field: "command",
          keywords: ["rm -rf", "chmod 777", "mkfs"],
          action: "block_and_alert",
          message: "Destructive shell command detected.",
        },
        {
          tool: "database_execute",
          condition: "arg_contains",
          field: "query",
          keywords: ["DROP TABLE", "TRUNCATE", "DELETE FROM"],
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
          message: "Production deploys require human approval.",
        },
      ],
    },
    null,
    2
  )}\n`;

  const nodeWrapper = `import { createGrimdall } from "grimdall-node";

const grimdall = createGrimdall();

export const protectedGithubDeleteRepo = grimdall.guardTool(
  "github_delete_repo",
  async ({ repoName }) => {
    // Call your real GitHub delete function here after Grimdall allows it.
    return { status: "deleted" };
  }
);
`;

  const langGraphWrapper = `import os
import re
import requests

GRIMDALL_ENDPOINT = os.getenv("GRIMDALL_ENDPOINT", "${endpoint}")
GRIMDALL_API_KEY = os.getenv("${apiKeyEnv}")
REDACTED = "[REDACTED]"
SENSITIVE_KEY_PATTERN = re.compile(
    r"(^|[_-])(authorization|api[-_]?key|access[-_]?token|auth[-_]?token|bearer|cookie|credential|email|jwt|mobile|pass(code|word)?|phone|secret|session|ssn|token)([_-]|$)",
    re.IGNORECASE,
)
EMAIL_PATTERN = re.compile(r"[^\\s@]+@[^\\s@]+\\.[^\\s@]+")
TOKEN_PATTERN = re.compile(
    r"\\b(gh[pousr]_[A-Za-z0-9_]{20,}|grimdall_sk_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|Bearer\\s+[A-Za-z0-9._-]+)\\b"
)
PHONE_PATTERN = re.compile(r"(?:\\+?\\d[\\s().-]*){10,}")

def redact_sensitive_arguments(value):
    if value is None:
        return value
    if isinstance(value, str):
        if EMAIL_PATTERN.search(value) or TOKEN_PATTERN.search(value) or PHONE_PATTERN.search(value):
            return REDACTED
        return value
    if isinstance(value, list):
        return [redact_sensitive_arguments(item) for item in value]
    if isinstance(value, dict):
        return {
            key: REDACTED if SENSITIVE_KEY_PATTERN.search(str(key)) else redact_sensitive_arguments(item)
            for key, item in value.items()
        }
    return value

def grimdall_check(tool, arguments):
    response = requests.post(
        GRIMDALL_ENDPOINT,
        headers={
            "Authorization": f"Bearer {GRIMDALL_API_KEY}",
            "Content-Type": "application/json",
        },
        json={"tool": tool, "arguments": redact_sensitive_arguments(arguments)},
        timeout=15,
    )
    response.raise_for_status()
    result = response.json()
    if result.get("status") == "blocked":
        raise RuntimeError(result.get("reason", "Blocked by Grimdall policy"))
    return result

def grimdall_guard_node(state):
    grimdall_check(state["tool"], state.get("arguments", {}))
    return state
`;

  const pythonWrapper = `from grimdall import Grimdall

grimdall = Grimdall()

def protected_github_delete_repo(arguments):
    grimdall.assert_allowed("github_delete_repo", arguments)
    # Call your real GitHub delete function here after Grimdall allows it.
    return {"status": "deleted"}
`;

  const claudeCodeWrapper = `#!/usr/bin/env node
const endpoint = process.env.GRIMDALL_ENDPOINT || "${endpoint}";
const apiKey = process.env.${apiKeyEnv};
const REDACTED = "[REDACTED]";
const sensitiveKeyPattern =
  /(^|[_-])(authorization|api[-_]?key|access[-_]?token|auth[-_]?token|bearer|cookie|credential|email|jwt|mobile|pass(code|word)?|phone|secret|session|ssn|token)([_-]|$)/i;
const emailPattern = /[^\\s@]+@[^\\s@]+\\.[^\\s@]+/;
const tokenPattern =
  /\\b(gh[pousr]_[A-Za-z0-9_]{20,}|grimdall_sk_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|Bearer\\s+[A-Za-z0-9._-]+)\\b/;
const phonePattern = /(?:\\+?\\d[\\s().-]*){10,}/;

function redactSensitiveArguments(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    return emailPattern.test(value) || tokenPattern.test(value) || phonePattern.test(value)
      ? REDACTED
      : value;
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitiveArguments);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKeyPattern.test(key) ? REDACTED : redactSensitiveArguments(item),
      ])
    );
  }
  return value;
}

export async function grimdallCheck(tool, args = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${apiKey}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tool, arguments: redactSensitiveArguments(args) }),
  });

  const result = await response.json();
  if (result.status === "blocked") {
    throw new Error(result.reason || "Blocked by Grimdall policy");
  }
  return result;
}
`;

  const envExample = `GRIMDALL_ENDPOINT=${endpoint}
${apiKeyEnv}=grimdall_sk_your_key_here
GRIMDALL_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
`;

  const setupGuide = `# Grimdall setup for ${projectName}

Grimdall is now ready to protect risky AI agent tool calls in this project.

## 1. Add your API key

Put this in your environment:

\`\`\`bash
${apiKeyEnv}=grimdall_sk_your_key_here
GRIMDALL_ENDPOINT=${endpoint}
\`\`\`

## 2. Wrap dangerous tools

Use the examples in \`grimdall-examples/\` as the starting point for your stack.

For Node:

\`\`\`bash
npm install grimdall-node
\`\`\`

For Python:

\`\`\`bash
pip install grimdall
\`\`\`

## 3. Manage policies in Grimdall

Add and edit rules in Grimdall. Your code keeps calling the same wrapper, and
Grimdall decides whether each risky tool call is allowed or blocked.
`;

  const writes = [
    writeFileIfSafe(join(root, "grimdall.config.json"), config, force, dryRun),
    writeFileIfSafe(join(root, "grimdall-examples", "node", "github-tool-wrapper.ts"), nodeWrapper, force, dryRun),
    writeFileIfSafe(join(root, "grimdall-examples", "python", "github_tool_wrapper.py"), pythonWrapper, force, dryRun),
    writeFileIfSafe(join(root, "grimdall-examples", "langgraph", "grimdall_guard.py"), langGraphWrapper, force, dryRun),
    writeFileIfSafe(join(root, "grimdall-examples", "claude-code", "grimdall-guard.js"), claudeCodeWrapper, force, dryRun),
    writeFileIfSafe(join(root, ".env.grimdall.example"), envExample, force, dryRun),
    writeFileIfSafe(join(root, "GRIMDALL_SETUP.md"), setupGuide, force, dryRun),
  ];

  console.log("Grimdall init complete");
  console.log(`Stack: ${stack}`);
  console.log(`Endpoint: ${endpoint}`);
  for (const item of writes) {
    console.log(`- ${item.status}: ${relative(root, item.path) || item.path}`);
  }
  console.log("");
  console.log("Next steps:");
  console.log(`1. Set ${apiKeyEnv}=your Grimdall API key`);
  console.log("2. Wrap dangerous tools with the generated Grimdall examples");
  console.log("3. Manage policies in Grimdall");
}

// ---------------------------------------------------------------------------
// Hooks installation (Claude Code, Cursor, Codex)
// ---------------------------------------------------------------------------

const HOOK_AGENTS = [
  { id: "claude", configPath: join(".claude", "settings.json") },
  { id: "cursor", configPath: join(".cursor", "hooks.json") },
  { id: "codex", configPath: join(".codex", "hooks.json") },
];

function detectHookTargets(projectDir) {
  const targets = [];
  for (const entry of HOOK_AGENTS) {
    if (existsSync(join(projectDir, entry.configPath)) || existsSync(join(projectDir, dirname(entry.configPath)))) {
      targets.push({ ...entry, exists: existsSync(join(projectDir, entry.configPath)) });
    }
  }
  return targets;
}




async function installHooks(projectDir) {
  const targets = detectHookTargets(projectDir);
  const hooksDir = join(projectDir, ".grimdall", "hooks");
  const hookPath = join(hooksDir, "pre-tool-use.js");
  const bundledHook = new URL("../hooks/pre-tool-use.cjs", import.meta.url);
  mkdirSync(hooksDir, { recursive: true });
  copyFileSync(bundledHook, hookPath);
  console.log(`- written: ${relative(projectDir, hookPath)}`);

  if (targets.length === 0) {
    console.log(
      "[INFO] No supported agent configs found. Hooks can be installed when one of these exists: .claude/settings.json, .cursor/hooks.json, .codex/hooks.json"
    );
    return;
  }

  for (const target of targets) {
    const configPath = join(projectDir, target.configPath);
    const command = `node "${hookPath}" --agent ${target.id} --project "${projectDir}"`;
    const previous = target.exists ? readFileSync(configPath, "utf8") : null;

    let config = {};
    if (previous) {
      try { config = JSON.parse(previous.replace(/^\uFEFF/, "")); } catch { config = {}; }
    }

    if (target.id === "claude") {
      config.hooks = config.hooks ?? {};
      const list = Array.isArray(config.hooks.PreToolUse) ? config.hooks.PreToolUse : [];
      if (!JSON.stringify(list).includes("pre-tool-use.js")) {
        list.push({ hooks: [{ type: "command", command }] });
      }
      config.hooks.PreToolUse = list;
    } else {
      config.hooks = Array.isArray(config.hooks) ? config.hooks : [];
      if (!JSON.stringify(config.hooks).includes("pre-tool-use.js")) {
        const matcher = target.id === "cursor" ? "preToolUse" : "PreToolUse";
        config.hooks.push({ matcher, hooks: [{ type: "command", command }] });
      }
    }

    const previousText = target.exists ? readFileSync(configPath, "utf8") : null;
    const nextText = JSON.stringify(config, null, 2) + "\n";

    if (previousText !== null && previousText !== nextText) {
      const backupsDir = join(projectDir, ".grimdall", "backups");
      mkdirSync(backupsDir, { recursive: true });
      writeFileSync(join(backupsDir, `${target.id}-${Date.now()}.json`), previousText);
      console.log(`- backed up: ${target.configPath}`);
    }
    writeFileSync(configPath, nextText);
    console.log(`- hook installed for ${target.id}: ${target.configPath}`);
  }
}

// ---------------------------------------------------------------------------
// Demo (0-config, local-only)
// ---------------------------------------------------------------------------

const DEMO_DANGEROUS = [
  /rm\s+-rf\s+(?:\/|~|\*|\$HOME|\.\s*$|[a-zA-Z]:[\\/])/i,
  /Remove-Item\s+.*-([Rr]ecurse|[Ff]orce)/i,
  /rmdir\s+\/s/i,
  /del\s+\/s\s+\/q/i,
  /format\s+[a-z]:/i,
  /mkfs/i,
  /dd\s+if=/i,
];

function demoBlocked(command) {
  return DEMO_DANGEROUS.some((pattern) => pattern.test(command));
}

function demoMask(value) {
  if (typeof value === "string") {
    return value.replace(/(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,})/g, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(demoMask);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, demoMask(v)]));
  }
  return value;
}

function verifyChain(entries) {
  let previousHash = "GENESIS";
  for (const entry of entries) {
    if (entry.previous_hash !== previousHash) {
      return { ok: false, entry };
    }
    const expected = createHash("sha256")
      .update(`${previousHash}${entry.tool}${entry.decision}${entry.timestamp}`)
      .digest("hex");
    if (entry.current_hash !== expected) {
      return { ok: false, entry };
    }
    previousHash = entry.current_hash;
  }
  return { ok: true };
}

function runDemo() {
  const root = cwd();
  const dotGrimdall = join(root, ".grimdall");
  mkdirSync(dotGrimdall, { recursive: true });
  const auditPath = join(dotGrimdall, "audit.json");

  console.log("[DEMO] Starting Grimdall zero-config demo...");
  console.log("");

  let entries = [];
  try { entries = JSON.parse(readFileSync(auditPath, "utf8")); }
  catch { entries = []; }
  let previousHash = entries.length > 0 ? entries[entries.length - 1].current_hash : "GENESIS";

  function auditEntry(tool, args, decision, reason) {
    const masked = demoMask(args);
    const id = createHash("sha256").update(`${Date.now()}${tool}${JSON.stringify(args)}`).digest("hex");
    const timestamp = new Date().toISOString();
    const entry = {
      id, timestamp, tool, arguments_masked: masked, decision, reason,
      previous_hash: previousHash,
      current_hash: createHash("sha256").update(`${previousHash}${tool}${decision}${timestamp}`).digest("hex"),
    };
    previousHash = entry.current_hash;
    entries.push(entry);
    return entry;
  }

  console.log('[DEMO] 1. Allowed call: shell "ls -la"');
  const allowed = auditEntry("shell", { command: "ls -la" }, "allowed", "Allowed by policy");
  console.log(`   decision: ${allowed.decision}`);
  console.log("");

  console.log('[DEMO] 2. Destructive call: shell "rm -rf /"');
  const blockedCommand = "rm -rf /";
  if (demoBlocked(blockedCommand)) {
    const blocked = auditEntry("shell", { command: blockedCommand }, "blocked", "Blocked by policy: destructive shell command");
    console.log(`   decision: ${blocked.decision} (${blocked.reason})`);
    console.log("   Nothing was executed. The command never reached the shell.");
  } else {
    console.log("   FAILED: policy did not detect the destructive command");
  }
  console.log("");

  console.log('[DEMO] 3. Masked secrets: callApi({ apiKey: "sk-<key>" })');
  const masked = auditEntry("callApi", { apiKey: "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL" }, "allowed", "Allowed by policy");
  console.log(`   audit stores: ${JSON.stringify(masked.arguments_masked)}`);
  console.log("");

  console.log("[DEMO] 4. Verifying audit trail hash chain...");
  const chain = verifyChain(entries);
  writeFileSync(auditPath, JSON.stringify(entries, null, 2) + "\n", "utf8");
  console.log(chain.ok ? `   [SUCCESS] Audit chain verified (${entries.length} entries, hash chain intact)` : "   [ERROR] Audit chain broken");
  console.log("");
  console.log("[DEMO] Done. View the tamper-evident audit trail:");
  console.log("   .grimdall/audit.json");

  writeFileSync(join(dotGrimdall, "config.json"), JSON.stringify({ version: 1, mode: "audit" }, null, 2) + "\n", "utf8");
  writeFileSync(join(dotGrimdall, "policies.json"), JSON.stringify([
    { id: "destructive_shell", tool: "shell_execute", condition: "arg_contains", field: "command", keywords: ["rm -rf", "Remove-Item -rf"], action: "block" },
  ], null, 2) + "\n", "utf8");
}

function runDoctor() {
  const root = cwd();
  console.log("[DOCTOR] Running Grimdall health checks...");
  console.log("");

  const configPath = join(root, "grimdall.config.json");
  const auditPath = join(root, ".grimdall", "audit.json");
  const hookPath = join(root, ".grimdall", "hooks", "pre-tool-use.js");
  const checks = [];

  checks.push({
    name: "Config file",
    ok: existsSync(configPath),
    message: existsSync(configPath) ? "Found grimdall.config.json" : "Missing grimdall.config.json",
    fix: 'Run "grimdall init"',
  });
  checks.push({
    name: "Audit trail",
    ok: existsSync(auditPath),
    message: existsSync(auditPath) ? "Found .grimdall/audit.json" : "Missing audit trail",
    fix: 'Run "grimdall demo" or "grimdall init --hooks"',
  });
  const targets = detectHookTargets(root);
  checks.push({
    name: "Hook runner",
    ok: existsSync(hookPath),
    message: existsSync(hookPath) ? "Hook runner installed" : "Hook runner missing",
    fix: 'Run "grimdall init --hooks"',
  });
  checks.push({
    name: "Agents detected",
    ok: targets.length > 0,
    message: targets.length > 0 ? `${targets.length} agent(s) detected` : "No supported agents detected",
    fix: "Install Claude Code, Cursor, or Codex",
  });

  let failed = false;
  for (const check of checks) {
    console.log(`  ${check.ok ? "[PASS]" : "[WARN]"} ${check.name}: ${check.message}`);
    if (!check.ok) console.log(`       Fix: ${check.fix}`);
    if (!check.ok) failed = true;
  }
  console.log("");
  console.log(failed ? "[WARNING] Some checks need attention." : "[SUCCESS] Grimdall is ready.");
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

if (command === "init") {
  await init();
  if (hasFlag("hooks")) {
    await installHooks(cwd());
  }
} else if (command === "demo") {
  runDemo();
  exit(0);
} else if (command === "doctor") {
  runDoctor();
  exit(0);
} else if (command === "--version" || command === "-v") {
  console.log(VERSION);
  exit(0);
} else if (command === "--help" || command === "-h") {
  printHelp();
  exit(0);
} else if (!command) {
  printHelp();
  exit(0);
} else {
  console.log(`[ERROR] Unknown command "${command}"`);
  printHelp();
  exit(1);
}

function printHelp() {
  console.log("Grimdall CLI - runtime security for AI agents");
  console.log("");
  console.log("Usage: grimdall <command>");
  console.log("");
  console.log("Commands:");
  console.log("  init                          Create config, policy, and wrappers");
  console.log("  init --hooks                  Detect agents and install PreToolUse guard hooks");
  console.log("  demo                          Run a zero-config demo (allow/block/mask)");
  console.log("  doctor                        Run health checks");
  console.log("  --version, -v                 Show the CLI version");
  console.log("  --help, -h                    Show this help message");
}
