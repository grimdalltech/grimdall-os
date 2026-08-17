import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AuditTrail, DEFAULT_POLICIES } from 'grimdall-core';
import type { AuditEntry, Policy } from 'grimdall-core';
import { generateWeeklyReport } from './report-generator.js';
import {
  buildHookConfig,
  detectAgentHookTargets,
  diffLines,
  HOOK_AGENT_DISPLAY_NAMES,
  HOOK_AGENT_IDS,
} from './hooks.js';
import { createGrimdall } from 'grimdall-node';

const VERSION = '0.2.1';
const CONFIG_FILE = join('.grimdall', 'config.json');
const DOT_GRIMDALL_DIR = '.grimdall';
const WORKSPACES_DIR = 'workspaces';
const UNSAFE_WORKSPACE_ID_PATTERN = /[\\/]|\.\./;

interface GlobalConfig {
  version: number;
  SLACK_WEBHOOK_URL?: string;
  WEBHOOK_PORT?: number;
  mode?: 'audit' | 'enforce';
}

interface WorkspaceConfig {
  version: number;
  workspaceId: string;
  clientName?: string;
  agencyName?: string;
}

interface ParsedFlags {
  options: Record<string, string | boolean>;
  positionals: string[];
}

function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  return writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  return readFile(filePath, 'utf8')
    .then((raw) => JSON.parse(raw) as T)
    .catch(() => fallback);
}

async function ensureWorkspaceDirectory(workspaceId: string): Promise<string> {
  const workspacePath = resolve(process.cwd(), WORKSPACES_DIR, workspaceId);
  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

function assertSafeWorkspaceId(workspaceId: string): boolean {
  if (UNSAFE_WORKSPACE_ID_PATTERN.test(workspaceId)) {
    console.log(`[ERROR] Invalid workspace name "${workspaceId}"`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

export async function cmdInit(options: { force?: boolean; hooks?: boolean } = {}): Promise<void> {
  const projectDir = process.cwd();
  const dotGrimdall = join(projectDir, DOT_GRIMDALL_DIR);
  const summary: string[] = [];

  const configPath = join(dotGrimdall, 'config.json');
  if (existsSync(configPath) && !options.force) {
    summary.push(`[SKIPPED] ${configPath} already exists (pass --force to overwrite)`);
  } else {
    await mkdir(dotGrimdall, { recursive: true });
    await writeJsonFile(configPath, {
      version: 1,
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
      WEBHOOK_PORT: 3001,
      mode: 'audit',
    } satisfies GlobalConfig);
    summary.push(`[SUCCESS] Created ${configPath}`);
  }

  const policiesPath = join(dotGrimdall, 'policies.json');
  if (existsSync(policiesPath) && !options.force) {
    summary.push(`[SKIPPED] ${policiesPath} already exists (pass --force to reset to defaults)`);
  } else {
    await writeJsonFile(policiesPath, DEFAULT_POLICIES);
    summary.push(`[SUCCESS] Created ${policiesPath}`);
  }

  const auditPath = join(dotGrimdall, 'audit.json');
  if (existsSync(auditPath)) {
    summary.push(`[SKIPPED] ${auditPath} already exists (audit trail preserved)`);
  } else {
    await writeJsonFile(auditPath, []);
    summary.push(`[SUCCESS] Created ${auditPath}`);
  }

  await cmdWorkspaceCreate('default', {
    client: 'Default Client',
    agency: 'Grimdall Technologies',
  });

  if (options.hooks) {
    await installAgentHooks(projectDir);
  }

  console.log('[SUCCESS] Grimdall initialized.');
  summary.forEach((line) => console.log(line));

  const policyIds = DEFAULT_POLICIES.map((policy) => policy.id).join(', ');
  console.log(`✓ Active policies: ${policyIds}`);
  console.log('✓ Secret masking + prompt-injection scanning: on');
  console.log('✓ Mode: audit (learn-only) — switch with `grimdall mode enforce`');
  console.log('');
  console.log('→ See it work: npx grimdall demo');
  console.log('→ Verify hooks: npx grimdall doctor');
  console.log('Local-only. No signup. No telemetry.');
}

async function installAgentHooks(projectDir: string): Promise<void> {
  const targets = detectAgentHookTargets(projectDir);
  const detected = new Set(targets.map((target) => target.agent));
  const protectedNames: string[] = [];

  for (const agentId of HOOK_AGENT_IDS) {
    if (detected.has(agentId)) {
      protectedNames.push(HOOK_AGENT_DISPLAY_NAMES[agentId]);
      continue;
    }
    console.log(`- ${HOOK_AGENT_DISPLAY_NAMES[agentId]}: not detected, skipped`);
  }

  if (targets.length === 0) {
    console.log(
      '[INFO] Install Claude Code, Cursor, or Codex in this project, then re-run "grimdall init --hooks".',
    );
    return;
  }

  const hooksDir = join(projectDir, DOT_GRIMDALL_DIR, 'hooks');
  const hookRunnerPath = join(hooksDir, 'pre-tool-use.js');
  await mkdir(hooksDir, { recursive: true });
  await copyFile(join(__dirname, '..', 'hooks', 'pre-tool-use.js'), hookRunnerPath);
  console.log(`[SUCCESS] Installed hook runner at ${hookRunnerPath}`);

  for (const target of targets) {
    const previousText = target.exists ? await readFile(target.configPath, 'utf8') : null;
    const nextText = buildHookConfig(target.agent, hookRunnerPath, projectDir, previousText);

    console.log(`[HOOK] Will modify: ${target.configPath}`);
    if (previousText === null) {
      console.log(diffLines('', nextText));
    } else {
      console.log(diffLines(previousText, nextText));
    }

    if (previousText !== null && previousText !== nextText) {
      const backupsDir = join(projectDir, DOT_GRIMDALL_DIR, 'backups');
      await mkdir(backupsDir, { recursive: true });
      const backupPath = join(backupsDir, `${target.agent}-${Date.now()}.json`);
      await writeFile(backupPath, previousText, 'utf8');
      console.log(`[HOOK] Backed up original to ${backupPath}`);
    }

    await writeFile(target.configPath, nextText, 'utf8');
    console.log(`[HOOK] Written ${target.configPath}`);
  }

  console.log(`✓ Protected: ${protectedNames.join(', ')}`);
}

async function cmdWorkspaceCreate(
  workspaceId: string,
  options: { client?: string; agency?: string } = {},
): Promise<void> {
  if (!workspaceId) {
    console.log('[ERROR] Workspace name is required');
    process.exitCode = 1;
    return;
  }

  if (!assertSafeWorkspaceId(workspaceId)) {
    return;
  }

  const workspacePath = await ensureWorkspaceDirectory(workspaceId);
  const policiesPath = join(workspacePath, 'policies.json');
  const auditPath = join(workspacePath, 'audit.json');
  const configPath = join(workspacePath, 'config.json');

  if (!existsSync(policiesPath)) {
    await writeJsonFile(policiesPath, DEFAULT_POLICIES);
  }

  if (!existsSync(auditPath)) {
    await writeJsonFile(auditPath, []);
  }

  const workspaceConfig: WorkspaceConfig = {
    version: 1,
    workspaceId,
    clientName: options.client,
    agencyName: options.agency,
  };
  await writeJsonFile(configPath, workspaceConfig);
  console.log(`[SUCCESS] Workspace '${workspaceId}' created.`);
}

async function cmdWorkspaceList(): Promise<void> {
  const workspacesRoot = resolve(process.cwd(), WORKSPACES_DIR);
  if (!existsSync(workspacesRoot)) {
    console.log('[INFO] No workspaces found.');
    return;
  }

  const entries = await readdir(workspacesRoot, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    console.log('[INFO] No workspaces found.');
    return;
  }

  names.forEach((name) => console.log(name));
}

async function cmdWorkspaceDelete(workspaceId: string): Promise<void> {
  if (!workspaceId) {
    console.log('[ERROR] Workspace name is required');
    process.exitCode = 1;
    return;
  }

  if (!assertSafeWorkspaceId(workspaceId)) {
    return;
  }

  const workspacePath = resolve(process.cwd(), WORKSPACES_DIR, workspaceId);
  const workspacesRoot = resolve(process.cwd(), WORKSPACES_DIR);
  if (!workspacePath.startsWith(workspacesRoot)) {
    console.log('[ERROR] Invalid workspace path');
    process.exitCode = 1;
    return;
  }

  if (!existsSync(workspacePath)) {
    console.log(`[ERROR] Workspace '${workspaceId}' does not exist`);
    process.exitCode = 1;
    return;
  }

  const confirmed = await promptConfirmation(
    `Delete workspace '${workspaceId}'? This will remove all policies, audit data, and reports.`,
  );

  if (!confirmed) {
    console.log('[INFO] Deletion cancelled');
    return;
  }

  await rm(workspacePath, { recursive: true, force: true });
  console.log(`[SUCCESS] Workspace '${workspaceId}' deleted.`);
}

async function cmdVerify(workspaceId: string, allowDotGrimdall = true): Promise<void> {
  if (!assertSafeWorkspaceId(workspaceId)) {
    return;
  }

  const auditTarget = resolveAuditTarget(workspaceId, allowDotGrimdall);
  const auditPath = join(auditTarget, 'audit.json');
  if (!existsSync(auditPath)) {
    console.log(`[ERROR] ${auditPath} not found`);
    process.exitCode = 1;
    return;
  }

  const trail = new AuditTrail(auditTarget);
  try {
    trail.verify();
    console.log(`[SUCCESS] Audit Verified (${trail.entriesCount()} entries, hash chain intact)`);
  } catch (error) {
    console.log(`[ERROR] Tampering Detected: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

async function cmdView(workspaceId: string, allowDotGrimdall = true): Promise<void> {
  if (!assertSafeWorkspaceId(workspaceId)) {
    return;
  }

  const auditTarget = resolveAuditTarget(workspaceId, allowDotGrimdall);
  const auditPath = join(auditTarget, 'audit.json');
  if (!existsSync(auditPath)) {
    console.log(`[ERROR] ${auditPath} not found`);
    process.exitCode = 1;
    return;
  }

  let entries: AuditEntry[];
  try {
    entries = JSON.parse(await readFile(auditPath, 'utf8')) as AuditEntry[];
  } catch {
    console.log(`[ERROR] ${auditPath} is not valid JSON`);
    process.exitCode = 1;
    return;
  }

  if (entries.length === 0) {
    console.log('No audit entries found');
    return;
  }

  const header = ['#', 'TIMESTAMP', 'TOOL', 'DECISION', 'REASON', 'POLICY', 'ARGUMENTS', 'HASH'];
  const rows = entries.map((entry, index) => [
    String(index + 1),
    entry.timestamp,
    entry.tool,
    entry.decision,
    truncate(entry.reason ?? '-', 42),
    entry.policy_matched ?? '-',
    truncate(JSON.stringify(entry.arguments_masked ?? {}), 60),
    entry.current_hash.slice(0, 12),
  ]);
  printTable([header, ...rows]);
}

async function cmdSetSlack(url: string): Promise<void> {
  if (!url) {
    console.log('[ERROR] Slack webhook URL is required');
    process.exitCode = 1;
    return;
  }

  const config = await readJsonFile<GlobalConfig>(CONFIG_FILE, { version: 1 });
  config.SLACK_WEBHOOK_URL = url;
  if (!config.WEBHOOK_PORT) {
    config.WEBHOOK_PORT = 3001;
  }
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeJsonFile(CONFIG_FILE, config);
  console.log(`[SUCCESS] Updated ${CONFIG_FILE}`);
}

async function cmdGenerateReport(
  workspaceId: string,
  options: { client?: string; agency?: string },
): Promise<void> {
  if (!workspaceId) {
    console.log('[ERROR] Workspace id is required');
    process.exitCode = 1;
    return;
  }

  if (!assertSafeWorkspaceId(workspaceId)) {
    return;
  }

  const workspacePath = resolve(process.cwd(), WORKSPACES_DIR, workspaceId);
  if (!existsSync(workspacePath)) {
    console.log(`[ERROR] Workspace '${workspaceId}' does not exist`);
    process.exitCode = 1;
    return;
  }

  const config = await readJsonFile<WorkspaceConfig>(join(workspacePath, 'config.json'), {
    version: 1,
    workspaceId,
  });
  const reportPath = await generateWeeklyReport(
    workspaceId,
    options.client ?? config.clientName,
    options.agency ?? config.agencyName,
  );
  console.log(`[SUCCESS] Report generated at ${reportPath}`);
}

export async function cmdDemo(): Promise<void> {
  console.log('[DEMO] Starting Grimdall zero-config demo...');
  console.log('');

  const grimdall = createGrimdall();
  console.log('[DEMO] Created Grimdall instance with zero-config (auto-created .grimdall/)');

  const wrappedRunShell = grimdall.wrapTool((cmd: string) => `[mock] executed: ${cmd}`, 'runShell');
  const wrappedCallApi = grimdall.wrapTool(
    (_opts: { apiKey: string }) => '[mock] api called (key redacted from audit)',
    'callApi',
  );

  console.log('');
  console.log('[DEMO] Running allowed call: runShell("ls -la")');
  const allowedResult = wrappedRunShell('ls -la');
  console.log(`  ${allowedResult}`);

  console.log('');
  console.log('[DEMO] Running blocked call: runShell("rm -rf /")');
  try {
    wrappedRunShell('rm -rf /');
  } catch (error) {
    console.log(`  ${(error as Error).message}`);
  }

  console.log('');
  console.log('[DEMO] Running masked secret call: callApi({ apiKey: "sk-<48-char-key>" })');
  const maskedResult = wrappedCallApi({
    apiKey: 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL',
  });
  console.log(`  ${maskedResult}`);
  const demoEntries = grimdall.auditTrail.getEntries();
  const maskedArgs = demoEntries[demoEntries.length - 1].arguments_masked;
  console.log(`  Audit stores: ${JSON.stringify(maskedArgs)}`);

  console.log('');
  console.log('[DEMO] Verifying audit trail...');
  try {
    grimdall.auditTrail.verify();
    console.log(
      `[SUCCESS] Audit Verified (${grimdall.auditTrail.entriesCount()} entries, hash chain intact)`,
    );
  } catch (error) {
    console.log(`[ERROR] Tampering Detected: ${(error as Error).message}`);
    process.exitCode = 1;
  }

  console.log('');
  console.log('[DEMO] Demo complete. Your .grimdall/ directory now contains:');
  console.log('  .grimdall/config.json      - global configuration');
  console.log('  .grimdall/policies.json    - security policies');
  console.log('  .grimdall/audit.json       - tamper-evident audit trail');
}

interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fixHint?: string;
}

export async function cmdDoctor(): Promise<void> {
  console.log('[DOCTOR] Running Grimdall health checks...');
  console.log('');

  const checks: DoctorCheck[] = [];

  const dotGrimdall = join(process.cwd(), DOT_GRIMDALL_DIR);
  const configPath = join(dotGrimdall, 'config.json');
  const policiesPath = join(dotGrimdall, 'policies.json');
  const auditPath = join(dotGrimdall, 'audit.json');

  // Check 1: .grimdall/config.json exists
  if (existsSync(configPath)) {
    checks.push({ name: 'Config file', status: 'pass', message: 'Found .grimdall/config.json' });
  } else {
    checks.push({
      name: 'Config file',
      status: 'fail',
      message: 'Missing .grimdall/config.json',
      fixHint: 'Run "grimdall init" to create config',
    });
  }

  // Check 2: policies.json exists and is valid
  if (existsSync(policiesPath)) {
    try {
      const policies = JSON.parse(readFileSync(policiesPath, 'utf8')) as Policy[];
      if (Array.isArray(policies) && policies.length > 0) {
        checks.push({
          name: 'Policies',
          status: 'pass',
          message: `Loaded ${policies.length} policies from .grimdall/policies.json`,
        });
      } else {
        checks.push({
          name: 'Policies',
          status: 'fail',
          message: '.grimdall/policies.json is empty or invalid',
          fixHint: 'Run "grimdall init --force" to reset policies',
        });
      }
    } catch {
      checks.push({
        name: 'Policies',
        status: 'fail',
        message: '.grimdall/policies.json is not valid JSON',
        fixHint: 'Run "grimdall init --force" to reset policies',
      });
    }
  } else {
    checks.push({
      name: 'Policies',
      status: 'fail',
      message: 'Missing .grimdall/policies.json',
      fixHint: 'Run "grimdall init" to create policies',
    });
  }

  // Check 3: audit.json exists and chain is valid
  if (existsSync(auditPath)) {
    try {
      const trail = new AuditTrail(dotGrimdall);
      trail.verify();
      checks.push({
        name: 'Audit chain',
        status: 'pass',
        message: `Audit chain valid (${trail.entriesCount()} entries)`,
      });
    } catch (error) {
      checks.push({
        name: 'Audit chain',
        status: 'fail',
        message: `Audit chain broken: ${(error as Error).message}`,
        fixHint: 'Check .grimdall/audit.json for tampering or corruption',
      });
    }
  } else {
    checks.push({
      name: 'Audit chain',
      status: 'fail',
      message: 'Missing .grimdall/audit.json',
      fixHint: 'Run "grimdall init" to create audit trail',
    });
  }

  // Check 4: hooks installed (advisory)
  const hooksDir = join(dotGrimdall, 'hooks');
  const hookRunnerPath = join(hooksDir, 'pre-tool-use.js');
  if (existsSync(hookRunnerPath)) {
    checks.push({
      name: 'Hook runner',
      status: 'pass',
      message: 'Hook runner installed at .grimdall/hooks/pre-tool-use.js',
    });
  } else {
    checks.push({
      name: 'Hook runner',
      status: 'warn',
      message: 'Hook runner not installed',
      fixHint: 'Run "grimdall init --hooks" to install agent hooks',
    });
  }

  // Check 5: agent hook configs (advisory)
  const agentTargets = detectAgentHookTargets(process.cwd());
  if (agentTargets.length > 0) {
    let hooksConfigured = 0;
    for (const target of agentTargets) {
      if (target.exists) {
        try {
          const content = readFileSync(target.configPath, 'utf8');
          if (content.includes('pre-tool-use.js')) {
            hooksConfigured++;
          }
        } catch {
          // ignore
        }
      }
    }
    if (hooksConfigured > 0) {
      checks.push({
        name: 'Agent hooks',
        status: 'pass',
        message: `${hooksConfigured} agent(s) configured with Grimdall hooks`,
      });
    } else {
      checks.push({
        name: 'Agent hooks',
        status: 'warn',
        message: 'No agents configured with Grimdall hooks',
        fixHint: 'Run "grimdall init --hooks" to install hooks for detected agents',
      });
    }
  } else {
    checks.push({
      name: 'Agent hooks',
      status: 'warn',
      message: 'No supported agents detected',
      fixHint: 'Install Claude Code, Cursor, or Codex to use hooks',
    });
  }

  // Check 6: Slack webhook (advisory)
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as { SLACK_WEBHOOK_URL?: string };
      if (config.SLACK_WEBHOOK_URL && !config.SLACK_WEBHOOK_URL.includes('YOUR')) {
        checks.push({
          name: 'Slack webhook',
          status: 'pass',
          message: 'Slack webhook URL configured',
        });
      } else {
        checks.push({
          name: 'Slack webhook',
          status: 'warn',
          message: 'Slack webhook URL not set (using placeholder)',
          fixHint: 'Run "grimdall config:set-slack <url>" to set a real webhook',
        });
      }
    } catch {
      checks.push({
        name: 'Slack webhook',
        status: 'warn',
        message: 'Could not read Slack webhook from config',
      });
    }
  } else {
    checks.push({
      name: 'Slack webhook',
      status: 'warn',
      message: 'Config missing, cannot check Slack webhook',
      fixHint: 'Run "grimdall init" first',
    });
  }

  // Print results
  let failed = false;
  for (const check of checks) {
    const status =
      check.status === 'pass' ? '[PASS]' : check.status === 'warn' ? '[WARN]' : '[FAIL]';
    console.log(`  ${status} ${check.name}: ${check.message}`);
    if (check.status !== 'pass' && check.fixHint) {
      console.log(`       Fix: ${check.fixHint}`);
    }
    if (check.status === 'fail') {
      failed = true;
    }
  }

  console.log('');
  if (failed) {
    console.log('[WARNING] Some checks failed. Run the suggested fixes above.');
    process.exitCode = 1;
  } else {
    console.log('[SUCCESS] All checks passed. Grimdall is healthy!');
  }
}

export async function cmdMode(target: string | undefined): Promise<void> {
  const config = await readJsonFile<GlobalConfig>(CONFIG_FILE, { version: 1 });

  if (target === undefined) {
    if (config.mode === 'audit') {
      console.log('Current mode: audit (learn-only)');
    } else if (config.mode === 'enforce') {
      console.log('Current mode: enforce');
    } else {
      console.log('Current mode: enforce (default)');
    }
    console.log('Switch with: grimdall mode audit|enforce');
    return;
  }

  if (target !== 'audit' && target !== 'enforce') {
    console.log(`[ERROR] Invalid mode "${target}". Use "audit" or "enforce".`);
    process.exitCode = 1;
    return;
  }

  config.mode = target;
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeJsonFile(CONFIG_FILE, config);
  console.log(`[SUCCESS] Mode set to ${target}.`);
  if (target === 'audit') {
    console.log(
      '  Blocked calls are recorded as "would_block" and allowed to proceed (learn-only).',
    );
  } else {
    console.log('  Blocked calls are stopped and recorded as "blocked" (hard enforcement).');
  }
}

export async function cmdLogin(): Promise<void> {
  console.log('[INFO] Login is optional and never required.');
  console.log('  - Local policies, hooks, and the audit trail work with no account.');
  console.log('  - Login is only needed for the Grimdall cloud dashboard and hosted alerts.');
  console.log('  - This open-source CLI requires no API key and sends no telemetry.');
}

function resolveAuditTarget(workspaceId: string, allowDotGrimdall: boolean): string {
  const workspacePath = resolve(process.cwd(), WORKSPACES_DIR, workspaceId);
  if (existsSync(join(workspacePath, 'audit.json'))) {
    return workspacePath;
  }
  if (allowDotGrimdall) {
    const dotGrimdallPath = join(process.cwd(), DOT_GRIMDALL_DIR);
    if (existsSync(join(dotGrimdallPath, 'audit.json'))) {
      return dotGrimdallPath;
    }
  }
  return workspacePath;
}

function truncate(input: string, max: number): string {
  if (input.length <= max) {
    return input;
  }
  return input.slice(0, max - 3) + '...';
}

function printTable(rows: string[][]): void {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }

  rows.forEach((row, rowIndex) => {
    const line = row
      .map((cell, index) => pad(cell, widths[index]))
      .join(' | ')
      .trimEnd();
    console.log(line);
    if (rowIndex === 0) {
      console.log(rows[0].map((_, index) => '-'.repeat(widths[index])).join('-+-'));
    }
  });
}

function pad(cell: string, width: number): string {
  return cell + ' '.repeat(Math.max(0, width - cell.length));
}

function printHelp(): void {
  console.log('Grimdall CLI - runtime security for AI agents');
  console.log('');
  console.log('Usage: grimdall <command>');
  console.log('');
  console.log('Commands:');
  console.log('  init                         Create .grimdall config, policies, and audit trail');
  console.log(
    '  init --force                 Recreate config and reset policies (audit is preserved)',
  );
  console.log('  init --hooks                 Detect agents and install PreToolUse guard hooks');
  console.log('  demo                         Run 10-second zero-config demo (allow/block/mask)');
  console.log(
    '  doctor                       Run health checks (config, policies, audit, hooks, Slack)',
  );
  console.log('  mode audit|enforce           Switch between learn-only and hard enforcement');
  console.log('  login                        Optional: link the cloud dashboard (never required)');
  console.log('  workspace:create <name>      Create a new workspace');
  console.log('  workspace:list               List all workspaces');
  console.log('  workspace:delete <name>      Delete a workspace');
  console.log('  audit:verify [--workspace]    Verify the audit trail hash chain');
  console.log('  audit:view [--workspace]      Pretty-print the audit log');
  console.log('  report:generate <id>          Generate a weekly PDF report');
  console.log('  config:set-slack <url>        Set the global Slack webhook URL');
  console.log('  --help, -h                    Show this help message');
  console.log('  --version, -v                 Show the CLI version');
}

function printVersion(): void {
  console.log(VERSION);
}

function parseFlags(argv: string[]): ParsedFlags {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[value.slice(2)] = next;
      index += 1;
    } else {
      options[value.slice(2)] = true;
    }
  }

  return { options, positionals };
}

async function promptConfirmation(question: string): Promise<boolean> {
  if (!input.isTTY) {
    return false;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  const rest = argv.slice(1);

  switch (command) {
    case 'init': {
      const { options } = parseFlags(rest);
      await cmdInit({
        force: options.force === true || options.force === 'true',
        hooks: options.hooks === true || options.hooks === 'true',
      });
      break;
    }
    case 'workspace:create': {
      const workspaceId = rest[0];
      const { options } = parseFlags(rest.slice(1));
      await cmdWorkspaceCreate(workspaceId, {
        client: typeof options.client === 'string' ? options.client : undefined,
        agency: typeof options.agency === 'string' ? options.agency : undefined,
      });
      break;
    }
    case 'workspace:list':
      await cmdWorkspaceList();
      break;
    case 'workspace:delete':
      await cmdWorkspaceDelete(rest[0]);
      break;
    case 'audit:verify': {
      const { options } = parseFlags(rest);
      const workspace = typeof options.workspace === 'string' ? options.workspace : 'default';
      await cmdVerify(workspace, typeof options.workspace !== 'string');
      break;
    }
    case 'audit:view': {
      const { options } = parseFlags(rest);
      const workspace = typeof options.workspace === 'string' ? options.workspace : 'default';
      await cmdView(workspace, typeof options.workspace !== 'string');
      break;
    }
    case 'report:generate': {
      const workspaceId = rest[0];
      const { options } = parseFlags(rest.slice(1));
      await cmdGenerateReport(workspaceId, {
        client: typeof options.client === 'string' ? options.client : undefined,
        agency: typeof options.agency === 'string' ? options.agency : undefined,
      });
      break;
    }
    case 'config:set-slack':
      await cmdSetSlack(rest[0]);
      break;
    case 'demo':
      await cmdDemo();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    case 'mode':
      await cmdMode(rest[0]);
      break;
    case 'login':
      await cmdLogin();
      break;
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    case '--version':
    case '-v':
      printVersion();
      break;
    default:
      console.log(`[ERROR] Unknown command "${command}"`);
      printHelp();
      process.exitCode = 1;
  }
}
