import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuditTrail } from './audit-trail';
import type { AuditEntry } from './types';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function makePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'grimdall-audit-')), 'audit.json');
}

function sampleEntry(id: string): Omit<AuditEntry, 'previous_hash' | 'current_hash'> {
  return {
    id,
    timestamp: '2026-01-01T00:00:00.000Z',
    tool: 'runShell',
    arguments_masked: { cmd: 'ls -la' },
    decision: 'allowed',
  };
}

describe('AuditTrail', () => {
  it('starts with an empty chain anchored to the genesis hash', () => {
    const trail = new AuditTrail(makePath());
    const entry = trail.addEntry(sampleEntry('1'));
    expect(entry.previous_hash).toBe('GENESIS');
    expect(entry.current_hash).toMatch(HASH_PATTERN);
    expect(trail.entriesCount()).toBe(1);
  });

  it('chains each entry to the previous entry hash', () => {
    const trail = new AuditTrail(makePath());
    const first = trail.addEntry(sampleEntry('1'));
    const second = trail.addEntry(sampleEntry('2'));
    expect(second.previous_hash).toBe(first.current_hash);
    expect(second.current_hash).not.toBe(first.current_hash);
  });

  it('persists entries to disk and reloads them', () => {
    const file = makePath();
    const trail = new AuditTrail(file);
    trail.addEntry(sampleEntry('1'));
    const reloaded = new AuditTrail(file);
    expect(reloaded.entriesCount()).toBe(1);
    expect(reloaded.getEntries()[0].id).toBe('1');
  });

  it('verifies an untampered chain', () => {
    const file = makePath();
    const trail = new AuditTrail(file);
    trail.addEntry(sampleEntry('1'));
    trail.addEntry(sampleEntry('2'));
    expect(() => new AuditTrail(file).verify()).not.toThrow();
  });

  it('detects tampered decisions', () => {
    const file = makePath();
    const trail = new AuditTrail(file);
    trail.addEntry(sampleEntry('1'));
    trail.addEntry(sampleEntry('2'));
    const raw = JSON.parse(readFileSync(file, 'utf8')) as AuditEntry[];
    raw[0].decision = 'blocked';
    writeFileSync(file, JSON.stringify(raw));
    expect(() => new AuditTrail(file).verify()).toThrow(/tampering detected/i);
  });

  it('detects broken hash chains', () => {
    const file = makePath();
    const trail = new AuditTrail(file);
    trail.addEntry(sampleEntry('1'));
    trail.addEntry(sampleEntry('2'));
    const raw = JSON.parse(readFileSync(file, 'utf8')) as AuditEntry[];
    raw[1].previous_hash = 'f'.repeat(64);
    writeFileSync(file, JSON.stringify(raw));
    expect(() => new AuditTrail(file).verify()).toThrow(/chain broken/i);
  });

  it('detects swapped entries', () => {
    const file = makePath();
    const trail = new AuditTrail(file);
    trail.addEntry(sampleEntry('1'));
    trail.addEntry({ ...sampleEntry('2'), arguments_masked: { cmd: 'rm -rf /' } });
    const raw = JSON.parse(readFileSync(file, 'utf8')) as AuditEntry[];
    const [a, b] = raw;
    writeFileSync(file, JSON.stringify([b, a]));
    expect(() => new AuditTrail(file).verify()).toThrow();
  });
});
