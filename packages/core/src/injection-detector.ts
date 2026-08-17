export interface InjectionResult {
  risk_score: number;
  patterns: string[];
}

interface PatternDefinition {
  name: string;
  regex: RegExp;
  score: number;
}

const PATTERNS: PatternDefinition[] = [
  {
    name: 'shell-destructive',
    regex: /(rm\s+-rf|mkfs|dd\s+if=|:\(\)\{:\|:&\};:)/gi,
    score: 50,
  },
  {
    name: 'sql-injection',
    regex: /(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UNION\s+SELECT)/gi,
    score: 50,
  },
  {
    name: 'path-traversal',
    regex: /\.\.[/\\]/g,
    score: 25,
  },
];

export function detectInjections(input: string): InjectionResult {
  const patterns: string[] = [];
  let riskScore = 0;

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(input)) !== null) {
      patterns.push(pattern.name);
      riskScore += pattern.score;
      if (pattern.regex.lastIndex === match.index) {
        pattern.regex.lastIndex += 1;
      }
    }
  }

  return { risk_score: riskScore, patterns };
}
