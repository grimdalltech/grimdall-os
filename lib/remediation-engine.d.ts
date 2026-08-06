export const REMEDIATION_RULES: Array<{
  match: RegExp;
  suggestion: string;
}>;

export function suggestRemediation(
  tool: string,
  args?: Record<string, unknown>,
): string;
