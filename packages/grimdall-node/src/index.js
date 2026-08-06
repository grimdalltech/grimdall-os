const DEFAULT_ENDPOINT = process.env.GRIMDALL_ENDPOINT ?? "";
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(authorization|api[-_]?key|access[-_]?token|auth[-_]?token|bearer|cookie|credential|email|jwt|mobile|pass(code|word)?|phone|secret|session|ssn|token)([_-]|$)/i;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TOKEN_PATTERN =
  /\b(gh[pousr]_[A-Za-z0-9_]{20,}|grimdall_sk_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]+)\b/;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){10,}/;

function containsSensitiveString(value) {
  return (
    EMAIL_PATTERN.test(value) ||
    TOKEN_PATTERN.test(value) ||
    PHONE_PATTERN.test(value)
  );
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function redactValue(value, seen) {
  if (value == null) return value;

  if (typeof value === "string") {
    return containsSensitiveString(value) ? REDACTED : value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => redactValue(item, seen));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(item, seen),
    ])
  );
}

export function redactSensitiveArguments(argumentsValue = {}) {
  return redactValue(argumentsValue, new WeakSet());
}

export class GrimdallPolicyError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "GrimdallPolicyError";
    this.result = result;
  }
}

export function createGrimdall(options = {}) {
  const endpoint = options.endpoint || process.env.GRIMDALL_ENDPOINT || DEFAULT_ENDPOINT;
  const apiKey = options.apiKey || process.env.GRIMDALL_API_KEY;
  const fetchImpl = options.fetch || globalThis.fetch;
  const argumentSanitizer =
    options.argumentSanitizer === null
      ? (argumentsValue) => argumentsValue
      : options.argumentSanitizer || redactSensitiveArguments;

  if (!endpoint) {
    throw new Error(
      "Grimdall endpoint is required. Set GRIMDALL_ENDPOINT or pass { endpoint } to createGrimdall()."
    );
  }

  if (!fetchImpl) {
    throw new Error("Grimdall requires fetch. Use Node 18+ or pass a fetch implementation.");
  }

  async function check(tool, args = {}) {
    const safeArguments = argumentSanitizer(args);
    const headers = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ tool, arguments: safeArguments }),
    });

    let result;
    try {
      result = await response.json();
    } catch {
      result = { status: "error", reason: `Grimdall returned HTTP ${response.status}` };
    }

    if (!response.ok) {
      const reason = result?.error || result?.reason || `Grimdall returned HTTP ${response.status}`;
      throw new Error(reason);
    }

    return result;
  }

  async function assertAllowed(tool, args = {}) {
    const result = await check(tool, args);

    if (result?.status === "blocked") {
      throw new GrimdallPolicyError(result.reason || "Blocked by Grimdall policy", result);
    }

    return result;
  }

  function guardTool(tool, handler) {
    return async function guardedGrimdallTool(args = {}) {
      await assertAllowed(tool, args);
      return handler(args);
    };
  }

  return {
    check,
    assertAllowed,
    guardTool,
  };
}

export function guardedTool(tool, handler, options = {}) {
  return createGrimdall(options).guardTool(tool, handler);
}
