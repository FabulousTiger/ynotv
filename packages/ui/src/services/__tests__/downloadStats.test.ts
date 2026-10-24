import { describe, expect, it } from 'vitest';
import {
  averageItemSeconds,
  estimateEtaSeconds,
  formatEta,
  groupDownloads,
  isRetryableError,
  retryDelayMs,
  summarizeQueue,
  type StatsItem,
} from '../downloadStats';

function item(over: Partial<StatsItem> & { id: string }): StatsItem {
  return {
    status: 'queued',
    progress: 0,
    bytesWritten: 0,
    totalBytes: null,
    speedBytes: 0,
    addedAt: 0,
    ...over,
  };
}

describe('groupDownloads', () => {
  it('orders the queue by run order and history newest first', () => {
    // The store prepends, so the array is newest-first
    const list = [
      item({ id: 'q3', addedAt: 30 }),
      item({ id: 'q2', addedAt: 20 }),
      item({ id: 'now', status: 'downloading', addedAt: 10 }),
      item({ id: 'h1', status: 'completed', addedAt: 1, finishedAt: 100 }),
      item({ id: 'h2', status: 'failed', addedAt: 2, startedAt: 200 }),
    ];
    const g = groupDownloads(list);
    expect(g.active.map((d) => d.id)).toEqual(['now']);
    expect(g.queue.map((d) => d.id)).toEqual(['q2', 'q3']);
    expect(g.history.map((d) => d.id)).toEqual(['h2', 'h1']);
  });
});

describe('estimateEtaSeconds', () => {
  it('uses bytes and speed when the size is known', () => {
    const d = item({ id: 'a', status: 'downloading', totalBytes: 1000, bytesWritten: 400, speedBytes: 100 });
    expect(estimateEtaSeconds(d, 0)).toBe(6);
  });

  it('falls back to elapsed time and percent', () => {
    const d = item({ id: 'a', status: 'downloading', progress: 25, startedAt: 0 });
    expect(estimateEtaSeconds(d, 10_000)).toBe(30);
  });

  it('returns null without data', () => {
    expect(estimateEtaSeconds(item({ id: 'a', status: 'downloading' }), 0)).toBeNull();
  });
});

describe('averageItemSeconds', () => {
  it('averages completed items only', () => {
    const list = [
      item({ id: 'a', status: 'completed', startedAt: 0, finishedAt: 60_000 }),
      item({ id: 'b', status: 'completed', startedAt: 0, finishedAt: 120_000 }),
      item({ id: 'c', status: 'failed', startedAt: 0, finishedAt: 999_000 }),
    ];
    expect(averageItemSeconds(list)).toBe(90);
  });
});

describe('summarizeQueue', () => {
  it('counts the batch and projects the queue from finished items', () => {
    const list = [
      item({ id: 'q', addedAt: 12 }),
      item({ id: 'now', status: 'downloading', addedAt: 11, progress: 50, totalBytes: 1000, bytesWritten: 500, speedBytes: 50 }),
      item({ id: 'done', status: 'completed', addedAt: 10, startedAt: 0, finishedAt: 100_000 }),
      item({ id: 'old', status: 'completed', addedAt: 1, startedAt: 0, finishedAt: 5 }),
    ];
    const s = summarizeQueue(list, 0);
    expect(s.remaining).toBe(2);
    expect(s.doneInBatch).toBe(1);
    expect(Math.round(s.percent)).toBe(50);
    // current 10 s + 1 queued * avg of (100 s, 0.005 s)
    expect(s.etaSeconds).toBeGreaterThan(10);
  });

  it('is empty when nothing is pending', () => {
    expect(summarizeQueue([item({ id: 'a', status: 'completed' })], 0).remaining).toBe(0);
  });
});

describe('formatEta', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatEta(30)).toBe('~30 s');
    expect(formatEta(12 * 60)).toBe('~12 min');
    expect(formatEta(3900)).toBe('~1 h 05 min');
    expect(formatEta(null)).toBe('--');
  });
});

describe('retries', () => {
  it('retries server and network errors only', () => {
    expect(isRetryableError('Server returned HTTP status 509 <unknown status code>')).toBe(true);
    expect(isRetryableError('Server returned HTTP status 503 Service Unavailable')).toBe(true);
    expect(isRetryableError('Server returned HTTP status 429 Too Many Requests')).toBe(true);
    expect(isRetryableError('HTTP request failed: error sending request: connection reset')).toBe(true);
    expect(isRetryableError('Server returned HTTP status 404 Not Found')).toBe(false);
    expect(isRetryableError('Server returned HTTP status 403 Forbidden')).toBe(false);
    expect(isRetryableError('Failed to open output file: access denied')).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it('backs off longer each attempt', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
  });

  it('puts a retried item behind everything queued before the retry', () => {
    const list = [
      item({ id: 'later', addedAt: 50 }),
      item({ id: 'retried', addedAt: 1, queuedAt: 100 }),
      item({ id: 'earlier', addedAt: 10 }),
    ];
    expect(groupDownloads(list).queue.map((d) => d.id)).toEqual(['earlier', 'later', 'retried']);
  });
});
