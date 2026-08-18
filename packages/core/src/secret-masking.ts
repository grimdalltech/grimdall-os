const OPENAI_KEY_PATTERN = /sk-[a-zA-Z0-9]{48}/g;
const AWS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/g;
const GH_TOKEN_PATTERN = /ghp_[a-zA-Z0-9]{36}/g;
const BEARER_PATTERN = /Bearer\s+[a-zA-Z0-9\-_.]+/gi;

export function maskSecrets(obj: any): any {
  const seen = new WeakSet<object>();
  return maskValue(cloneValue(obj, seen), seen);
}

function cloneValue(value: any, seen: WeakSet<object>): any {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  let out: any;
  if (value instanceof Date) {
    out = new Date(value.getTime());
  } else if (value instanceof RegExp) {
    out = value.toString();
  } else if (value instanceof Map) {
    out = Array.from(value.entries());
  } else if (value instanceof Set) {
    out = Array.from(value.values());
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    out = value.toString('base64');
  } else if (Array.isArray(value)) {
    out = value.map((item) => cloneValue(item, seen));
  } else {
    out = {};
    for (const key of Object.keys(value)) {
      out[key] = cloneValue(value[key], seen);
    }
  }

  seen.delete(value);
  return out;
}

function maskValue(value: any, seen: WeakSet<object>): any {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? maskString(value) : value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = maskValue(value[index], seen);
    }
  } else {
    for (const key of Object.keys(value)) {
      value[key] = maskValue(value[key], seen);
    }
  }

  seen.delete(value);
  return value;
}

function maskString(input: string): string {
  return input
    .replace(OPENAI_KEY_PATTERN, '[REDACTED_OPENAI_KEY]')
    .replace(AWS_KEY_PATTERN, '[REDACTED_AWS_KEY]')
    .replace(GH_TOKEN_PATTERN, '[REDACTED_GH_TOKEN]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]');
}
