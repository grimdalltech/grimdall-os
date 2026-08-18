import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { AuditEntry } from './types.js';

const GENESIS_HASH = 'GENESIS';
const AUDIT_FILE_NAME = 'audit.json';

export class AuditTrail {
  private readonly filePath: string;
  private entries: AuditEntry[];

  constructor(workspacePath: string) {
    this.filePath = resolveAuditPath(workspacePath);
    this.entries = this.load();
  }

  addEntry(entry: Omit<AuditEntry, 'previous_hash' | 'current_hash'>): AuditEntry {
    const previousHash =
      this.entries.length > 0 ? this.entries[this.entries.length - 1].current_hash : GENESIS_HASH;
    const currentHash = hashPayload(entry) + previousHash;
    const fullEntry: AuditEntry = {
      ...entry,
      previous_hash: previousHash,
      current_hash: sha256(currentHash),
    };
    this.entries.push(fullEntry);
    this.persist();
    return fullEntry;
  }

  verify(): void {
    let previousHash = GENESIS_HASH;
    for (const entry of this.entries) {
      if (entry.previous_hash !== previousHash) {
        throw new Error(`Chain broken at entry "${entry.id}": previous_hash mismatch`);
      }
      if (sha256(hashPayload(entry) + previousHash) !== entry.current_hash) {
        throw new Error(`Hash mismatch at entry "${entry.id}": tampering detected`);
      }
      previousHash = entry.current_hash;
    }
  }

  entriesCount(): number {
    return this.entries.length;
  }

  getEntries(): AuditEntry[] {
    return this.entries;
  }

  private load(): AuditEntry[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2) + '\n', 'utf8');
  }
}

function hashPayload(entry: Record<string, any>): string {
  const { previous_hash, current_hash, ...rest } = entry;
  return JSON.stringify(rest);
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function resolveAuditPath(workspacePath: string): string {
  if (workspacePath.endsWith('.json')) {
    return workspacePath;
  }

  if (basename(workspacePath) === AUDIT_FILE_NAME) {
    return workspacePath;
  }

  return join(workspacePath, AUDIT_FILE_NAME);
}
