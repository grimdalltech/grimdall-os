export function detectPromptInjection(input: string): {
  blocked: boolean;
  reason: string | null;
  matches: string[];
};

export function extractPromptCandidate(input: unknown): string | null;
