import { create } from 'zustand';
import type { ProbeChannelResult } from '../services/stream-probe';
import {
  appendLog,
  buildLogEntry,
  cacheKey,
  isFresh,
  pruneExpired,
  sanitizeProbeCache,
  slimResult,
  type ProbeCacheEntry,
  type ProbeCacheKvValue,
  type ProbeLogEntry,
} from '../services/probeCache';
import { bindStoreToKv } from './persistToKv';

const STORAGE_KEY = 'probe-cache';

interface ProbeCacheState {
  entries: Record<string, ProbeCacheEntry>;
  log: ProbeLogEntry[];
  /** Store a finished probe: refreshes the cache entry and appends to the log. */
  record: (result: ProbeChannelResult, sourceName?: string) => void;
  /** Fresh cached entry for a stream, or undefined when missing or expired. */
  getFresh: (sourceId: string, streamId: string) => ProbeCacheEntry | undefined;
  clearCache: () => void;
}

export const useProbeCacheStore = create<ProbeCacheState>()((set, get) => ({
  entries: {},
  log: [],

  record: (result, sourceName) => {
    const at = Date.now();
    set((state) => ({
      entries: {
        ...pruneExpired(state.entries, at),
        [cacheKey(result.source_id, result.stream_id)]: { result: slimResult(result), at },
      },
      log: appendLog(state.log, buildLogEntry(result, at, sourceName)),
    }));
  },

  getFresh: (sourceId, streamId) => {
    const entry = get().entries[cacheKey(sourceId, streamId)];
    return entry && isFresh(entry, Date.now()) ? entry : undefined;
  },

  clearCache: () => set({ entries: {} }),
}));

// SQLite-backed persistence, same pattern as the Stremio stores
bindStoreToKv<ProbeCacheKvValue>(
  STORAGE_KEY,
  (raw) => JSON.parse(raw) as ProbeCacheKvValue,
  (value) => {
    if (value) useProbeCacheStore.setState({ entries: value.entries, log: value.log });
  },
  (state) => JSON.stringify({ entries: state.entries, log: state.log }),
  () => {
    const s = useProbeCacheStore.getState();
    return { entries: s.entries, log: s.log };
  },
  (fn) => useProbeCacheStore.subscribe(fn),
  (value) => sanitizeProbeCache(value, Date.now())
);
