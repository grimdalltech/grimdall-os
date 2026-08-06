import { loadGrimdallConfig } from "./grimdall-config.js";

export const DEFAULT_ALLOWLIST_RULES = [
  {
    tool: "shell_execute",
    pattern: /^rm\s+-rf\s+\.\/(build|dist|node_modules|\.next|tmp)(?:\/.*)?$/i,
  },
  {
    tool: "shell_execute",
    pattern: /^rm\s+-rf\s+(?:\.\/)?(build|dist|node_modules|\.next|tmp)(?:\/.*)?$/i,
  },
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRegExp(pattern) {
  if (pattern instanceof RegExp) {
    return pattern;
  }

  if (typeof pattern === "string" && pattern.trim()) {
    return new RegExp(pattern, "i");
  }

  return null;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const tool =
    typeof entry.tool === "string" && entry.tool.trim() ? entry.tool.trim() : "*";
  const pattern = toRegExp(entry.pattern);

  if (!pattern) {
    return null;
  }

  return { tool, pattern };
}

function buildSearchableInput(tool, args = {}) {
  const commandCandidate =
    typeof args.command === "string"
      ? args.command
      : typeof args.input === "string"
        ? args.input
        : "";

  if (commandCandidate.trim()) {
    return commandCandidate.trim();
  }

  try {
    return JSON.stringify({ tool, args });
  } catch {
    return String(tool);
  }
}

export function compileAllowlistRules(entries = []) {
  const compiled = entries
    .map(normalizeEntry)
    .filter(Boolean);

  return [...DEFAULT_ALLOWLIST_RULES, ...compiled];
}

export function loadAllowlistRulesFromConfig() {
  return compileAllowlistRules(loadGrimdallConfig().allowlist);
}

export function isAllowlisted(tool, args = {}, allowlistRules = loadAllowlistRulesFromConfig()) {
  const searchableInput = buildSearchableInput(tool, args);

  return allowlistRules.some((rule) => {
    if (!rule || typeof rule.pattern?.test !== "function") {
      return false;
    }

    return (rule.tool === "*" || rule.tool === tool) && rule.pattern.test(searchableInput);
  });
}

export function buildAllowlistRule(tool, patternSource) {
  return {
    tool,
    pattern: toRegExp(patternSource),
  };
}

export { escapeRegExp };
