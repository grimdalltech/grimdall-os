export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const result = stringify(value, seen);
  return result ?? 'null';
}

function stringify(value: unknown, seen: WeakSet<object>): string | undefined {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null';
    case 'boolean':
      return String(value);
    case 'bigint':
      return String(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }

  const object = value as object;
  if (object instanceof Date) {
    return JSON.stringify(object.toISOString());
  }
  if (object instanceof RegExp) {
    return '{}';
  }
  if (seen.has(object)) {
    return JSON.stringify('[Circular]');
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const items = object.map((item) => stringify(item, seen) ?? 'null');
      return `[${items.join(',')}]`;
    }
    const parts: string[] = [];
    for (const key of Object.keys(object)) {
      const serialized = stringify((object as Record<string, unknown>)[key], seen);
      if (serialized === undefined) {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${serialized}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(object);
  }
}
