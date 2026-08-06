import { suggestRemediation } from "./remediation-engine.js";
import { isAllowlisted, loadAllowlistRulesFromConfig } from "./allowlist.js";

const API_KEY_PREFIX = "grimdall_sk_";
const DEFAULT_EGRESS_ALLOWLIST = parseAllowlist(
  process.env.GRIMDALL_EGRESS_ALLOWLIST ?? process.env.EGRESS_ALLOWLIST ?? "",
);

const TOOL_ALIASES = {
  github_delete_repo: [
    "github_delete_repo",
    "github.deleteRepo",
    "github.repos.delete",
    "github_delete_repository",
    "delete_repository",
    "delete_repo",
  ],
  shell_rm_rf: [
    "shell_rm_rf",
    "shell.rm_rf",
    "shell.rm",
    "terminal_rm_rf",
    "delete_files_recursive",
    "shell_command",
    "terminal_command",
    "bash_command",
    "execute_shell",
  ],
  deploy_production: [
    "deploy_production",
    "deploy.production",
    "vercel_promote_production",
    "production_deploy",
  ],
  database_drop_table: [
    "database_drop_table",
    "db_drop_table",
    "sql_drop_table",
    "database.dropTable",
  ],
};

const SHELL_TOOL_HINTS = new Set([
  "shell_command",
  "terminal_command",
  "bash_command",
  "execute_shell",
  "shell_rm_rf",
  "shell.rm_rf",
  "shell.rm",
  "terminal_rm_rf",
]);

const DANGEROUS_SHELL_PATTERNS = [
  /\brm\s+-rf\s+(?:\/(?:\s|$)|\/\*|~|\*|\$HOME|\.\s*$)/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(?:\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\bInvoke-WebRequest\b/i,
  /\biwr\b/i,
  /\bStart-BitsTransfer\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b/i,
  /\bnetcat\b/i,
  /\bscp\b/i,
  /\bsftp\b/i,
  /\brsync\b/i,
  /\bbase64\b/i,
  /\bopenssl\s+enc\b/i,
];

const PIPE_TO_SHELL_PATTERN = /\|\s*(bash|sh|zsh|pwsh|powershell)\b/i;

function parseAllowlist(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
}

function normalizeHost(host) {
  return host.toLowerCase().replace(/^www\./, "");
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s'"`<>\\()]+/gi) ?? [];

  return matches.flatMap((raw) => {
    try {
      return [new URL(raw)];
    } catch {
      return [];
    }
  });
}

function isHostAllowed(host, allowlist) {
  const normalizedHost = normalizeHost(host);

  return allowlist.some((allowed) => {
    const normalizedAllowed = normalizeHost(allowed);
    return (
      normalizedHost === normalizedAllowed ||
      normalizedHost.endsWith(`.${normalizedAllowed}`)
    );
  });
}

function expandToolAliases(tool) {
  const normalized = tool.trim();
  const aliases = new Set([normalized]);

  for (const values of Object.values(TOOL_ALIASES)) {
    if (values.includes(normalized)) {
      values.forEach((value) => aliases.add(value));
    }
  }

  return Array.from(aliases);
}

function isShellTool(toolName) {
  return SHELL_TOOL_HINTS.has(toolName.trim());
}

function extractShellCommand(argumentsValue) {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return "";
  }

  const candidate = argumentsValue;
  const commandKeys = [
    "command",
    "cmd",
    "shell",
    "script",
    "bash",
    "powershell",
    "sh",
    "args",
  ];

  for (const key of commandKeys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function inspectShellCommand(command, allowlist = DEFAULT_EGRESS_ALLOWLIST) {
  const normalized = String(command ?? "").trim();

  if (!normalized) {
    return { blocked: false };
  }

  if (isAllowlisted("shell_execute", { command: normalized }, loadAllowlistRulesFromConfig())) {
    return { blocked: false };
  }

  for (const pattern of DANGEROUS_SHELL_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        blocked: true,
        reason: "Blocked risky shell command.",
        remediation: suggestRemediation("shell_execute", { command: normalized }),
      };
    }
  }

  if (PIPE_TO_SHELL_PATTERN.test(normalized)) {
    return {
      blocked: true,
      reason: "Blocked shell pipeline execution.",
      remediation: suggestRemediation("shell_execute", { command: normalized }),
    };
  }

  const urls = extractUrls(normalized);

  for (const url of urls) {
    if (!isHostAllowed(url.hostname, allowlist)) {
      return {
        blocked: true,
        reason: `Blocked external domain: ${url.hostname}`,
        remediation: suggestRemediation("shell_execute", { command: normalized }),
      };
    }
  }

  if (allowlist.length === 0 && /(curl|wget|Invoke-WebRequest|iwr|Start-BitsTransfer)/i.test(normalized)) {
    return {
      blocked: true,
      reason: "Blocked shell networking command.",
      remediation: suggestRemediation("shell_execute", { command: normalized }),
    };
  }

  return { blocked: false };
}

export {
  API_KEY_PREFIX,
  DEFAULT_EGRESS_ALLOWLIST,
  TOOL_ALIASES,
  expandToolAliases,
  extractShellCommand,
  inspectShellCommand,
  isShellTool,
  parseAllowlist,
};
