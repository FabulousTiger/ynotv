/**
 * downloadStats.ts
 *
 * Pure grouping, ETA and formatting helpers for the Downloads view. No store or
 * Tauri imports, so they are unit-testable on their own.
 */

export interface StatsItem {
  id: string;
  status: 'downloading' | 'queued' | 'completed' | 'failed' | 'canceled' | 'paused';
  progress: number;
  bytesWritten: number;
  totalBytes: number | null;
  speedBytes: number;
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface GroupedDownloads<T extends StatsItem> {
  active: T[];
  /** In the order they will run (oldest queued first). */
  queue: T[];
  paused: T[];
  /** Finished, failed and canceled, newest first. */
  history: T[];
}

/** The store prepends new items, so the oldest queued item is the last in the array. */
export function groupDownloads<T extends StatsItem>(downloads: readonly T[]): GroupedDownloads<T> {
  const byAddedAsc = (a: T, b: T) => a.addedAt - b.addedAt;
  const doneAt = (d: T) => d.finishedAt ?? d.startedAt ?? d.addedAt;
  return {
    active: downloads.filter((d) => d.status === 'downloading').sort(byAddedAsc),
    queue: downloads.filter((d) => d.status === 'queued').sort(byAddedAsc),
    paused: downloads.filter((d) => d.status === 'paused').sort(byAddedAsc),
    history: downloads
      .filter((d) => d.status === 'completed' || d.status === 'failed' || d.status === 'canceled')
      .sort((a, b) => doneAt(b) - doneAt(a)),
  };
}

/** Seconds left for one active item, or null when there is nothing to base it on. */
export function estimateEtaSeconds(item: StatsItem, now: number): number | null {
  if (item.totalBytes && item.totalBytes > 0 && item.speedBytes > 0) {
    return Math.max(0, (item.totalBytes - item.bytesWritten) / item.speedBytes);
  }
  if (item.progress >= 2 && item.progress < 100 && item.startedAt !== undefined) {
    const elapsed = (now - item.startedAt) / 1000;
    if (elapsed > 3) return Math.max(0, (elapsed * (100 - item.progress)) / item.progress);
  }
  return null;
}

/** Mean wall time of the most recent completed downloads, in seconds. */
export function averageItemSeconds(downloads: readonly StatsItem[], sample = 10): number | null {
  const times = downloads
    .filter(
      (d) => d.status === 'completed' && d.startedAt !== undefined && d.finishedAt !== undefined && d.finishedAt > d.startedAt
    )
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .slice(0, sample)
    .map((d) => ((d.finishedAt as number) - (d.startedAt as number)) / 1000);
  if (times.length === 0) return null;
  return times.reduce((a, b) => a + b, 0) / times.length;
}

export interface QueueSummary {
  /** Items still to finish: active + queued (paused ones are not counted). */
  remaining: number;
  /** Items finished since the oldest pending item was queued (the current batch). */
  doneInBatch: number;
  /** Overall batch progress, 0-100. */
  percent: number;
  /** Seconds until everything pending is finished, or null when unknown. */
  etaSeconds: number | null;
}

export function summarizeQueue(downloads: readonly StatsItem[], now: number): QueueSummary {
  const { active, queue, paused } = groupDownloads(downloads);
  const pending = [...active, ...queue, ...paused];
  const remaining = active.length + queue.length;
  if (pending.length === 0) return { remaining: 0, doneInBatch: 0, percent: 0, etaSeconds: null };

  const batchStart = Math.min(...pending.map((d) => d.addedAt));
  const doneInBatch = downloads.filter(
    (d) => d.status === 'completed' && (d.finishedAt ?? d.addedAt) >= batchStart
  ).length;
  const total = doneInBatch + remaining;
  const activeFraction = active.reduce((sum, d) => sum + Math.min(100, Math.max(0, d.progress)) / 100, 0);
  const percent = total > 0 ? ((doneInBatch + activeFraction) / total) * 100 : 0;

  // Current item from its own stats; the queued ones from the average of finished items,
  // falling back to the first active item's projected total time.
  let etaSeconds: number | null = null;
  const current = active[0];
  const currentEta = current ? estimateEtaSeconds(current, now) : null;
  let perItem = averageItemSeconds(downloads);
  if (perItem === null && current?.startedAt !== undefined && current.progress >= 2) {
    perItem = (((now - current.startedAt) / 1000) * 100) / current.progress;
  }
  if (queue.length === 0) {
    etaSeconds = currentEta;
  } else if (perItem !== null) {
    etaSeconds = (currentEta ?? (current ? perItem : 0)) + queue.length * perItem;
  }
  return { remaining, doneInBatch, percent, etaSeconds };
}

/** "~45 s", "~12 min", "~1 h 05 min". */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--';
  const s = Math.round(seconds);
  if (s < 60) return `~${Math.max(1, s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `~${m} min`;
  return `~${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return '0 KB/s';
  const kb = bytesPerSec / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB/s` : `${(kb / 1024).toFixed(2)} MB/s`;
}
