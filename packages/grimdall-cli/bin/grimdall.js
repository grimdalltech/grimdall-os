#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { cwd, env, exit, stdin, stdout } from "node:process";

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

  const nodeWrapper = `import { createGrimdall } from "@grimdall/node";

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
npm install @grimdall/node
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

if (command === "init") {
  await init();
} else {
  console.log("Grimdall AI CLI");
  console.log("");
  console.log("Usage:");
  console.log("  grimdall init");
  console.log("  grimdall init --yes");
  console.log("  grimdall init --stack node,langgraph");
  console.log("  grimdall init --endpoint https://your-app.vercel.app/api/execute");
  exit(command ? 1 : 0);
}
