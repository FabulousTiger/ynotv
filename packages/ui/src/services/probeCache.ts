/**
 * probeCache.ts
 *
 * Pure helpers for the probe result cache and the probe log. No I/O and no
 * store imports; the zustand store (stores/probeCacheStore.ts) persists what
 * these functions produce.
 */

import type { ProbeChannelResult } from './stream-probe';

/** A cached probe result stays fresh for this long. */
export const PROBE_CACHE_TTL_MS = 30 * 60 * 1000;
/** The probe log keeps only the most recent entries. */
export const PROBE_LOG_MAX = 5000;

export interface ProbeCacheEntry {
  result: ProbeChannelResult;
  /** Epoch ms of the probe. */
  at: number;
}

export interface ProbeLogEntry {
  ts: number;
  time: string;
  source_id: string;
  source: string;
  stream_id: string;
  channel: string;
  height: number | null;
  fps: number | null;
  video_kbps: number | null;
  codec: string | null;
  status: string;
}

export function cacheKey(sourceId: string, streamId: string): string {
  return `${sourceId}::${streamId}`;
}

/** Fresh cached probe result for a channel-like item, if any. */
export function cachedResultFor(
  entries: Record<string, ProbeCacheEntry>,
  item: { source_id: string; stream_id: string },
  now: number
): ProbeChannelResult | undefined {
  const entry = entries[cacheKey(item.source_id, item.stream_id)];
  return entry && isFresh(entry, now) ? entry.result : undefined;
}

export function isFresh(entry: ProbeCacheEntry, now: number, ttlMs: number = PROBE_CACHE_TTL_MS): boolean {
  return now - entry.at < ttlMs;
}

/** Whole minutes since the probe, never negative. */
export function ageMinutes(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / 60000));
}

/** Drop expired entries. Returns the same object when nothing expired. */
export function pruneExpired(
  entries: Record<string, ProbeCacheEntry>,
  now: number,
  ttlMs: number = PROBE_CACHE_TTL_MS
): Record<string, ProbeCacheEntry> {
  let changed = false;
  const next: Record<string, ProbeCacheEntry> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (isFresh(entry, now, ttlMs)) next[key] = entry;
    else changed = true;
  }
  return changed ? next : entries;
}

/** Cache copy of a result without the stream URL (it can embed credentials). */
export function slimResult(result: ProbeChannelResult): ProbeChannelResult {
  return { ...result, url: '', screenshot_path: undefined };
}

export function buildLogEntry(result: ProbeChannelResult, at: number, sourceName?: string): ProbeLogEntry {
  const kbps = result.video_bitrate_kbps ?? result.bitrate_kbps;
  return {
    ts: at,
    time: new Date(at).toISOString(),
    source_id: result.source_id,
    source: sourceName || result.source_id,
    stream_id: result.stream_id,
    channel: result.name,
    height: typeof result.height === 'number' ? result.height : null,
    fps: typeof result.fps === 'number' ? result.fps : null,
    video_kbps: typeof kbps === 'number' ? kbps : null,
    codec: result.video_codec ?? null,
    status: result.status,
  };
}

/** Append an entry, keeping only the newest `max`. */
export function appendLog(log: ProbeLogEntry[], entry: ProbeLogEntry, max: number = PROBE_LOG_MAX): ProbeLogEntry[] {
  const next = [...log, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

export interface ProbeCacheKvValue {
  entries: Record<string, ProbeCacheEntry>;
  log: ProbeLogEntry[];
}

/** Validate a persisted blob; returns null when the shape is wrong. */
export function sanitizeProbeCache(value: unknown, now: number): ProbeCacheKvValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as { entries?: unknown; log?: unknown };
  if (!v.entries || typeof v.entries !== 'object' || Array.isArray(v.entries)) return null;
  if (!Array.isArray(v.log)) return null;
  const entries: Record<string, ProbeCacheEntry> = {};
  for (const [key, raw] of Object.entries(v.entries as Record<string, unknown>)) {
    const e = raw as Partial<ProbeCacheEntry> | null;
    if (e && typeof e.at === 'number' && e.result && typeof e.result === 'object') {
      entries[key] = e as ProbeCacheEntry;
    }
  }
  const log = (v.log as ProbeLogEntry[]).slice(-PROBE_LOG_MAX);
  return { entries: pruneExpired(entries, now), log };
}
