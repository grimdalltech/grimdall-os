const SUSPICIOUS_PATTERNS = [
  {
    pattern: /ignore\s+(?:all\s+)?previous\s+instructions/i,
    label: "ignore previous instructions",
  },
  {
    pattern: /system\s+prompt/i,
    label: "system prompt",
  },
  {
    pattern: /\boverride\b/i,
    label: "override",
  },
  {
    pattern: /\bDAN\b/i,
    label: "DAN",
  },
  {
    pattern: /developer\s*mode/i,
    label: "Developer Mode",
  },
  {
    pattern: /output\s+only/i,
    label: "output only",
  },
  {
    pattern: /do\s+not\s+mention/i,
    label: "do not mention",
  },
];

const BASE64_TOKEN_PATTERN = /(?:^|[^A-Za-z0-9+/=])([A-Za-z0-9+/]{60,}={0,2})(?:[^A-Za-z0-9+/=]|$)/g;

function isLikelyBase64Token(token) {
  if (typeof token !== "string" || token.length < 60) {
    return false;
  }

  if (token.length % 4 !== 0 && !token.endsWith("=") && !token.endsWith("==")) {
    return false;
  }

  return /^[A-Za-z0-9+/=]+$/.test(token);
}

function decodeBase64Token(token) {
  try {
    return Buffer.from(token, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function isPrintableText(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  const printable = value.replace(/[\r\n\t]/g, "");
  return printable.length > 0 && /[a-zA-Z]/.test(printable);
}

export function detectPromptInjection(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    return {
      blocked: false,
      reason: null,
      matches: [],
    };
  }

  const normalized = input.trim();
  const matches = [];

  for (const candidate of SUSPICIOUS_PATTERNS) {
    if (candidate.pattern.test(normalized)) {
      matches.push(candidate.label);
    }
  }

  for (const match of normalized.matchAll(BASE64_TOKEN_PATTERN)) {
    const token = match[1];
    if (!isLikelyBase64Token(token)) {
      continue;
    }

    const decoded = decodeBase64Token(token);
    if (isPrintableText(decoded)) {
      matches.push("base64 payload");
      break;
    }
  }

  if (matches.length === 0) {
    return {
      blocked: false,
      reason: null,
      matches: [],
    };
  }

  return {
    blocked: true,
    reason: "Prompt injection detected",
    matches,
  };
}

export function extractPromptCandidate(input) {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const candidateKeys = [
    "prompt",
    "user_input",
    "userInput",
    "input",
    "message",
    "text",
  ];

  for (const key of candidateKeys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  const nestedSources = [input.arguments, input.context, input.payload];

  for (const source of nestedSources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    for (const key of candidateKeys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }

  return null;
}
