/**
 * Probe cache and probe log helpers (probeCache.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  PROBE_CACHE_TTL_MS,
  PROBE_LOG_MAX,
  ageMinutes,
  appendLog,
  buildLogEntry,
  cacheKey,
  isFresh,
  pruneExpired,
  sanitizeProbeCache,
  slimResult,
  type ProbeCacheEntry,
} from '../probeCache';
import type { ProbeChannelResult } from '../stream-probe';

function make(id: string, over: Partial<ProbeChannelResult> = {}): ProbeChannelResult {
  return {
    stream_id: id,
    source_id: 'src_1',
    name: `Channel ${id}`,
    url: `http://user:pass@test.stream/${id}.ts`,
    status: 'alive',
    ...over,
  };
}

describe('cache freshness', () => {
  const entry: ProbeCacheEntry = { result: make('a'), at: 1_000_000 };

  it('is fresh just under 30 minutes and expired at 30 minutes', () => {
    expect(isFresh(entry, entry.at + PROBE_CACHE_TTL_MS - 1)).toBe(true);
    expect(isFresh(entry, entry.at + PROBE_CACHE_TTL_MS)).toBe(false);
  });

  it('keys by source and stream', () => {
    expect(cacheKey('s1', '10')).not.toBe(cacheKey('s2', '10'));
    expect(cacheKey('s1', '10')).toBe(cacheKey('s1', '10'));
  });

  it('reports whole minutes and never goes negative', () => {
    expect(ageMinutes(0, 59_999)).toBe(0);
    expect(ageMinutes(0, 4 * 60_000 + 5_000)).toBe(4);
    expect(ageMinutes(10_000, 0)).toBe(0);
  });

  it('prunes only expired entries', () => {
    const now = 10 * PROBE_CACHE_TTL_MS;
    const entries = {
      old: { result: make('old'), at: now - PROBE_CACHE_TTL_MS - 1 },
      fresh: { result: make('fresh'), at: now - 1000 },
    };
    expect(Object.keys(pruneExpired(entries, now))).toEqual(['fresh']);
    const allFresh = { fresh: entries.fresh };
    expect(pruneExpired(allFresh, now)).toBe(allFresh);
  });
});

describe('slimResult', () => {
  it('drops the stream url so credentials are not persisted', () => {
    expect(slimResult(make('a', { height: 720 })).url).toBe('');
    expect(slimResult(make('a', { height: 720 })).height).toBe(720);
  });
});

describe('probe log', () => {
  it('records the fields needed to choose cutoffs later', () => {
    const entry = buildLogEntry(
      make('a', { height: 1080, fps: 50, video_bitrate_kbps: 4200, video_codec: 'h264' }),
      Date.UTC(2026, 0, 2, 3, 4, 5),
      'Provider'
    );
    expect(entry).toMatchObject({
      time: '2026-01-02T03:04:05.000Z',
      source: 'Provider',
      source_id: 'src_1',
      stream_id: 'a',
      channel: 'Channel a',
      height: 1080,
      fps: 50,
      video_kbps: 4200,
      codec: 'h264',
      status: 'alive',
    });
  });

  it('uses nulls for unknown values and falls back to the source id', () => {
    const entry = buildLogEntry(make('d', { status: 'dead' }), 0);
    expect(entry.height).toBeNull();
    expect(entry.fps).toBeNull();
    expect(entry.video_kbps).toBeNull();
    expect(entry.codec).toBeNull();
    expect(entry.source).toBe('src_1');
  });

  it('keeps only the newest entries', () => {
    let log = [] as ReturnType<typeof appendLog>;
    for (let i = 0; i < PROBE_LOG_MAX + 3; i++) {
      log = appendLog(log, buildLogEntry(make(String(i)), i));
    }
    expect(log).toHaveLength(PROBE_LOG_MAX);
    expect(log[0].stream_id).toBe('3');
    expect(log[log.length - 1].stream_id).toBe(String(PROBE_LOG_MAX + 2));
  });
});

describe('sanitizeProbeCache', () => {
  it('rejects wrong shapes', () => {
    expect(sanitizeProbeCache(null, 0)).toBeNull();
    expect(sanitizeProbeCache([], 0)).toBeNull();
    expect(sanitizeProbeCache({ entries: [], log: [] }, 0)).toBeNull();
    expect(sanitizeProbeCache({ entries: {} }, 0)).toBeNull();
  });

  it('drops expired and malformed entries and keeps the rest', () => {
    const now = 5 * PROBE_CACHE_TTL_MS;
    const value = sanitizeProbeCache(
      {
        entries: {
          fresh: { result: make('fresh'), at: now - 1000 },
          old: { result: make('old'), at: 0 },
          junk: { at: now },
        },
        log: [],
      },
      now
    );
    expect(value && Object.keys(value.entries)).toEqual(['fresh']);
  });
});
