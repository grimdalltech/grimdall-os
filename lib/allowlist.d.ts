export interface AllowlistRule {
  tool: string;
  pattern: RegExp;
}

export const DEFAULT_ALLOWLIST_RULES: AllowlistRule[];
export function compileAllowlistRules(entries?: Array<{ tool?: string; pattern?: string | RegExp }>): AllowlistRule[];
export function loadAllowlistRulesFromConfig(): AllowlistRule[];
export function isAllowlisted(
  tool: string,
  args?: Record<string, unknown>,
  allowlistRules?: AllowlistRule[],
): boolean;
export function buildAllowlistRule(tool: string, patternSource: string | RegExp): AllowlistRule | null;
