import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolCall } from './types.js';

export type ReviewDecision = 'approve' | 'deny';

export interface PendingReviewRecord {
  reviewId: string;
  toolCall: ToolCall;
  resolve: (decision: ReviewDecision) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

interface PendingReviewSnapshot {
  reviewId: string;
  toolCall: ToolCall;
  timestamp: number;
}

export class ReviewManager {
  private readonly pendingReviews = new Map<string, PendingReviewRecord>();
  private readonly persistencePath?: string;

  constructor(persistencePath?: string) {
    this.persistencePath = persistencePath;
    if (persistencePath) {
      const orphaned = this.loadSnapshots();
      if (orphaned > 0) {
        console.warn(
          `[WARN] Discarded ${orphaned} pending review(s) orphaned by a previous process. ` +
            'Human reviews cannot be restored across a process restart.',
        );
      }
    }
  }

  addPendingReview(review: PendingReviewRecord): void {
    this.pendingReviews.set(review.reviewId, review);
    this.persistSnapshots();
  }

  resolveReview(reviewId: string, decision: ReviewDecision): boolean {
    const pending = this.pendingReviews.get(reviewId);
    if (!pending) {
      return false;
    }

    this.pendingReviews.delete(reviewId);
    this.persistSnapshots();

    if (decision === 'approve') {
      pending.resolve(decision);
    } else {
      pending.reject(new Error(`Review denied for ${reviewId}`));
    }

    return true;
  }

  cleanupExpiredReviews(timeoutMs: number): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [reviewId, pending] of this.pendingReviews.entries()) {
      if (now - pending.timestamp <= timeoutMs) {
        continue;
      }

      this.pendingReviews.delete(reviewId);
      pending.reject(new Error(`Review timed out for ${reviewId}`));
      cleaned += 1;
    }

    if (cleaned > 0) {
      this.persistSnapshots();
    }

    return cleaned;
  }

  private loadSnapshots(): number {
    if (!this.persistencePath || !existsSync(this.persistencePath)) {
      return 0;
    }

    let orphanedCount = 0;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.persistencePath, 'utf8'));
      if (Array.isArray(parsed)) {
        orphanedCount = (parsed as PendingReviewSnapshot[]).length;
      }
    } catch {
      orphanedCount = 0;
    }

    if (orphanedCount > 0) {
      this.persistSnapshots();
    }

    return orphanedCount;
  }

  private persistSnapshots(): void {
    if (!this.persistencePath) {
      return;
    }

    const snapshots: PendingReviewSnapshot[] = [...this.pendingReviews.values()].map(
      ({ reviewId, toolCall, timestamp }) => ({
        reviewId,
        toolCall,
        timestamp,
      }),
    );

    writeFileSync(this.persistencePath, JSON.stringify(snapshots, null, 2) + '\n', 'utf8');
  }
}

export function createReviewManagerPath(workspacePath: string): string {
  return join(workspacePath, 'pending-reviews.json');
}
