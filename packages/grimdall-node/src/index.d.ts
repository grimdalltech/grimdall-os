export type GrimdallStatus = "allowed" | "blocked" | "error";

export interface GrimdallResult {
  status: GrimdallStatus;
  reason?: string;
  [key: string]: unknown;
}

export interface GrimdallOptions {
  endpoint?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  argumentSanitizer?: ((args: Record<string, unknown>) => unknown) | null;
}

export class GrimdallPolicyError extends Error {
  result: GrimdallResult;
  constructor(message: string, result: GrimdallResult);
}

export interface GrimdallClient {
  check(tool: string, args?: Record<string, unknown>): Promise<GrimdallResult>;
  assertAllowed(tool: string, args?: Record<string, unknown>): Promise<GrimdallResult>;
  guardTool<TArgs extends Record<string, unknown>, TResult>(
    tool: string,
    handler: (args: TArgs) => Promise<TResult> | TResult
  ): (args?: TArgs) => Promise<TResult>;
}

export function createGrimdall(options?: GrimdallOptions): GrimdallClient;

export function guardedTool<TArgs extends Record<string, unknown>, TResult>(
  tool: string,
  handler: (args: TArgs) => Promise<TResult> | TResult,
  options?: GrimdallOptions
): (args?: TArgs) => Promise<TResult>;

export function redactSensitiveArguments(argumentsValue?: unknown): unknown;
