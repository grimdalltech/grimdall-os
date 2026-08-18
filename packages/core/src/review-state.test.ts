import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewManager } from './review-state';

function makePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'grimdall-reviews-')), 'pending-reviews.json');
}

describe('ReviewManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a pending review with approve', async () => {
    const manager = new ReviewManager(makePath());
    const approval = new Promise<'approve' | 'deny'>((resolve, reject) => {
      manager.addPendingReview({
        reviewId: 'r1',
        toolCall: { tool: 't', arguments: {} },
        resolve,
        reject,
        timestamp: Date.now(),
      });
    });
    expect(manager.resolveReview('r1', 'approve')).toBe(true);
    await expect(approval).resolves.toBe('approve');
  });

  it('rejects a pending review with deny', async () => {
    const manager = new ReviewManager(makePath());
    const approval = new Promise<'approve' | 'deny'>((resolve, reject) => {
      manager.addPendingReview({
        reviewId: 'r1',
        toolCall: { tool: 't', arguments: {} },
        resolve,
        reject,
        timestamp: Date.now(),
      });
    });
    manager.resolveReview('r1', 'deny');
    await expect(approval).rejects.toThrow('Review denied for r1');
  });

  it('returns false when resolving an unknown review id', () => {
    const manager = new ReviewManager(makePath());
    expect(manager.resolveReview('missing', 'approve')).toBe(false);
  });

  it('cleans up expired reviews and leaves fresh ones alone', async () => {
    const manager = new ReviewManager(makePath());
    const expired = new Promise((resolve, reject) => {
      manager.addPendingReview({
        reviewId: 'old',
        toolCall: { tool: 't', arguments: {} },
        resolve,
        reject,
        timestamp: Date.now() - 60_000,
      });
    });
    const fresh = new Promise((resolve, reject) => {
      manager.addPendingReview({
        reviewId: 'new',
        toolCall: { tool: 't', arguments: {} },
        resolve,
        reject,
        timestamp: Date.now(),
      });
    });
    expect(manager.cleanupExpiredReviews(30_000)).toBe(1);
    await expect(expired).rejects.toThrow(/timed out/i);
    expect(manager.resolveReview('new', 'approve')).toBe(true);
    await expect(fresh).resolves.toBe('approve');
  });

  it('persists snapshots and purges orphaned ones on reload', () => {
    const file = makePath();
    const manager = new ReviewManager(file);
    manager.addPendingReview({
      reviewId: 'r1',
      toolCall: { tool: 't', arguments: {} },
      resolve: () => undefined,
      reject: () => undefined,
      timestamp: Date.now(),
    });
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);

    const reloaded = new ReviewManager(file);
    expect(reloaded.resolveReview('r1', 'approve')).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('does not warn when no snapshots exist', () => {
    const warn = vi.spyOn(console, 'warn');
    new ReviewManager(makePath());
    expect(warn).not.toHaveBeenCalled();
  });
});
