import { describe, expect, it } from 'vitest';
import { detectInjections } from './injection-detector';

describe('detectInjections', () => {
  it('flags destructive shell commands as critical', () => {
    const result = detectInjections('run: rm -rf /');
    expect(result.risk_score).toBe(50);
    expect(result.patterns).toContain('shell-destructive');
  });

  it('flags destructive shell patterns case-insensitively', () => {
    const result = detectInjections('RM -RF /');
    expect(result.patterns).toContain('shell-destructive');
  });

  it('flags SQL injection as critical', () => {
    const result = detectInjections('SELECT * FROM users; DROP TABLE users');
    expect(result.risk_score).toBe(50);
    expect(result.patterns).toContain('sql-injection');
  });

  it('flags path traversal as high risk', () => {
    const result = detectInjections('cat ../secret');
    expect(result.risk_score).toBe(25);
    expect(result.patterns).toContain('path-traversal');
  });

  it('scores each occurrence of a pattern', () => {
    const result = detectInjections('cat ../../etc/passwd');
    expect(result.risk_score).toBe(50);
    expect(result.patterns).toEqual(['path-traversal', 'path-traversal']);
  });

  it('sums scores when multiple patterns are present', () => {
    const result = detectInjections('rm -rf / && DROP TABLE users && cat ../secret');
    expect(result.risk_score).toBe(125);
    expect(result.patterns).toHaveLength(3);
  });

  it('returns zero risk for benign input', () => {
    const result = detectInjections('list files in the current directory');
    expect(result.risk_score).toBe(0);
    expect(result.patterns).toHaveLength(0);
  });
});
