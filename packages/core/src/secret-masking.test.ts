import { describe, expect, it } from 'vitest';
import { maskSecrets } from './secret-masking';

describe('maskSecrets', () => {
  it('masks OpenAI API keys', () => {
    const masked = maskSecrets({ apiKey: 'sk-' + 'a'.repeat(48) });
    expect(masked.apiKey).toBe('[REDACTED_OPENAI_KEY]');
  });

  it('masks AWS access keys', () => {
    const masked = maskSecrets({ key: 'AKIA' + 'A'.repeat(16) });
    expect(masked.key).toBe('[REDACTED_AWS_KEY]');
  });

  it('masks GitHub personal access tokens', () => {
    const masked = maskSecrets({ token: 'ghp_' + 'a'.repeat(36) });
    expect(masked.token).toBe('[REDACTED_GH_TOKEN]');
  });

  it('masks bearer tokens', () => {
    const masked = maskSecrets({ authorization: 'Bearer abc.def-ghi_jkl' });
    expect(masked.authorization).toBe('Bearer [REDACTED]');
  });

  it('deep clones the input and masks nested values', () => {
    const input = {
      headers: { authorization: 'Bearer top.secret' },
      body: { apiKey: 'sk-' + 'b'.repeat(48) },
      ok: true,
    };
    const masked = maskSecrets(input);
    expect(masked.headers.authorization).toBe('Bearer [REDACTED]');
    expect(masked.body.apiKey).toBe('[REDACTED_OPENAI_KEY]');
    expect(masked.ok).toBe(true);
    expect(input.headers.authorization).toBe('Bearer top.secret');
    expect(input.body.apiKey).not.toBe('[REDACTED_OPENAI_KEY]');
    expect(masked).not.toBe(input);
    expect(masked.headers).not.toBe(input.headers);
  });

  it('masks secrets inside arrays', () => {
    const masked = maskSecrets(['plain', 'sk-' + 'c'.repeat(48)]);
    expect(masked[1]).toBe('[REDACTED_OPENAI_KEY]');
  });

  it('leaves benign values untouched', () => {
    expect(maskSecrets({ message: 'hello world' })).toEqual({ message: 'hello world' });
  });

  it('does not crash on circular references', () => {
    const input: Record<string, any> = { x: 1 };
    input.self = input;
    const masked = maskSecrets(input);
    expect(masked.self).toBe('[Circular]');
    expect(masked.x).toBe(1);
  });

  it('breaks shared-reference cycles at any depth', () => {
    const input: Record<string, any> = { nested: { y: 2 } };
    input.nested.parent = input;
    const masked = maskSecrets(input);
    expect(masked.nested.parent).toBe('[Circular]');
  });

  it('preserves Date values', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const masked = maskSecrets({ createdAt: date });
    expect(masked.createdAt).toBeInstanceOf(Date);
    expect(masked.createdAt.getTime()).toBe(date.getTime());
  });

  it('serializes Map, Set, Buffer and BigInt values to JSON-safe forms', () => {
    const masked = maskSecrets({
      map: new Map<string, number>([['a', 1]]),
      set: new Set<number>([1, 2]),
      buffer: Buffer.from('payload', 'utf8'),
      big: 9007199254740993n,
    });
    expect(masked.map).toEqual([['a', 1]]);
    expect(masked.set).toEqual([1, 2]);
    expect(masked.buffer).toBe(Buffer.from('payload', 'utf8').toString('base64'));
    expect(masked.big).toBe('9007199254740993');
    expect(() => JSON.stringify(masked)).not.toThrow();
  });

  it('still masks secrets nested under special values', () => {
    const masked = maskSecrets({
      list: new Map<string, string>([['key', 'sk-' + 'd'.repeat(48)]]),
    });
    expect(masked.list).toEqual([['key', '[REDACTED_OPENAI_KEY]']]);
  });
});
