import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type HookAgentId = 'claude' | 'cursor' | 'codex';

export interface AgentHookTarget {
  agent: HookAgentId;
  configPath: string;
  exists: boolean;
}

const HOOK_AGENTS: { id: HookAgentId; configPath: string }[] = [
  { id: 'claude', configPath: '.claude/settings.json' },
  { id: 'cursor', configPath: '.cursor/hooks.json' },
  { id: 'codex', configPath: '.codex/hooks.json' },
];

export const HOOK_AGENT_IDS: HookAgentId[] = HOOK_AGENTS.map((entry) => entry.id);

export const HOOK_AGENT_DISPLAY_NAMES: Record<HookAgentId, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
};

export function detectAgentHookTargets(projectDir: string): AgentHookTarget[] {
  const targets: AgentHookTarget[] = [];
  for (const entry of HOOK_AGENTS) {
    const configPath = join(projectDir, entry.configPath);
    const exists = existsSync(configPath);
    const hasDirectory = existsSync(dirname(configPath));
    if (exists || hasDirectory) {
      targets.push({ agent: entry.id, configPath, exists });
    }
  }
  return targets;
}

export function buildHookCommand(
  hookRunnerPath: string,
  agent: HookAgentId,
  projectDir: string,
): string {
  return `node "${hookRunnerPath}" --agent ${agent} --project "${projectDir}"`;
}

export function buildHookConfig(
  agent: HookAgentId,
  hookRunnerPath: string,
  projectDir: string,
  previousText: string | null,
): string {
  const command = buildHookCommand(hookRunnerPath, agent, projectDir);
  const existing = parseJson(previousText);

  if (agent === 'claude') {
    const config = existing ?? {};
    config.hooks = config.hooks ?? {};
    const list = Array.isArray(config.hooks.PreToolUse) ? config.hooks.PreToolUse : [];
    if (!JSON.stringify(list).includes('pre-tool-use.js')) {
      list.push({ hooks: [{ type: 'command', command }] });
    }
    config.hooks.PreToolUse = list;
    return format(config);
  }

  const matcher = agent === 'cursor' ? 'preToolUse' : 'PreToolUse';
  const config = existing ?? {};
  const list = Array.isArray(config.hooks) ? config.hooks : [];
  if (!JSON.stringify(list).includes('pre-tool-use.js')) {
    const hook = { type: 'command', command } as Record<string, any>;
    if (agent === 'cursor') {
      hook.timeout = 5000;
    }
    list.push({ matcher, hooks: [hook] });
  }
  config.hooks = list;
  return format(config);
}

export function diffLines(oldText: string, newText: string): string {
  const before = normalize(oldText) === '' ? [] : normalize(oldText).split('\n');
  const after = normalize(newText) === '' ? [] : normalize(newText).split('\n');
  const output: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i >= before.length) {
      output.push(`+${after[j]}`);
      j += 1;
      continue;
    }
    if (j >= after.length) {
      output.push(`-${before[i]}`);
      i += 1;
      continue;
    }
    if (before[i] === after[j]) {
      output.push(` ${before[i]}`);
      i += 1;
      j += 1;
      continue;
    }
    const appearsLater = after.slice(j + 1).includes(before[i]);
    if (appearsLater) {
      output.push(`+${after[j]}`);
      j += 1;
      continue;
    }
    output.push(`-${before[i]}`);
    i += 1;
  }
  return output.join('\n');
}

function parseJson(text: string | null): Record<string, any> | null {
  if (!text) {
    return null;
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return null;
  }
}

function format(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '');
}
