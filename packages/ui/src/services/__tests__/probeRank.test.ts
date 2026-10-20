/**
 * Sports "Probe & rank" ordering and tier heuristic (probeRank.ts).
 *
 * High frame rate (>= 50 fps) streams sort first, then height, then bitrate.
 * Nothing is excluded for low fps; no-signal streams sink with the dead ones.
 */
import { describe, it, expect } from 'vitest';
import {
  rankResults,
  sortByProbe,
  classifyTier,
  isNoSignal,
  resolutionClass,
  resolutionLabel,
  fpsClass,
  bitrateClass,
  estimateRemainingSeconds,
  formatDuration,
  type RankedGroups,
} from '../probeRank';
import type { ProbeChannelResult } from '../stream-probe';

function make(id: string, over: Partial<ProbeChannelResult> = {}): ProbeChannelResult {
  return {
    stream_id: id,
    source_id: 'src_1',
    name: `Channel ${id}`,
    url: `http://test.stream/${id}.ts`,
    status: 'alive',
    ...over,
  };
}

function ids(list: ProbeChannelResult[]): string[] {
  return list.map((r) => r.stream_id);
}

describe('rankResults', () => {
  it('puts >= 50 fps first, then height desc, then bitrate desc', () => {
    const groups: RankedGroups = rankResults([
      make('a', { height: 720, fps: 60, video_bitrate_kbps: 5000 }),
      make('b', { height: 1080, fps: 50, video_bitrate_kbps: 4000 }),
      make('c', { height: 1080, fps: 60, video_bitrate_kbps: 3000 }),
      make('d', { height: 1080, fps: 60, video_bitrate_kbps: 6000 }),
      make('e', { height: 2160, fps: 25, video_bitrate_kbps: 9000 }),
      make('f', { height: 1080, fps: 25, video_bitrate_kbps: 5000 }),
    ]);
    expect(ids(groups.ranked)).toEqual(['d', 'b', 'c', 'a', 'e', 'f']);
  });

  it('ranks 720p50 above 1080p25 and never excludes low fps', () => {
    const groups = rankResults([
      make('hd25', { height: 1080, fps: 25, video_bitrate_kbps: 5000 }),
      make('hd30', { height: 1080, fps: 30, video_bitrate_kbps: 5000 }),
      make('p50', { height: 720, fps: 50, video_bitrate_kbps: 3000 }),
    ]);
    expect(ids(groups.ranked)).toEqual(['p50', 'hd25', 'hd30']);
    expect(groups.dead).toEqual([]);
  });

  it('treats video bitrate under 100 kbps as no signal, grouped with the dead', () => {
    const groups = rankResults([
      make('hi', { height: 720, fps: 60, video_bitrate_kbps: 3000 }),
      make('starved', { height: 1080, fps: 60, video_bitrate_kbps: 90 }),
      make('dead', { status: 'dead' }),
    ]);
    expect(ids(groups.ranked)).toEqual(['hi']);
    expect(ids(groups.dead).sort()).toEqual(['dead', 'starved']);
  });

  it('puts dead streams last in their own group and keeps pending apart', () => {
    const groups = rankResults([
      make('dead', { status: 'dead', height: 2160, fps: 60 }),
      make('geo', { status: 'geoblocked' }),
      make('wait', { status: 'pending' }),
      make('ok', { height: 480, fps: 50, video_bitrate_kbps: 1500 }),
    ]);
    expect(ids(groups.ranked)).toEqual(['ok']);
    expect(ids(groups.pending)).toEqual(['wait']);
    expect(ids(groups.dead)).toEqual(['dead', 'geo']);
  });

  it('does not treat unknown or exactly 100 kbps bitrate as no signal', () => {
    expect(isNoSignal(make('x', { height: 1080 }))).toBe(false);
    expect(isNoSignal(make('y', { fps: 25, video_bitrate_kbps: 100 }))).toBe(false);
    expect(isNoSignal(make('z', { video_bitrate_kbps: 99 }))).toBe(true);
  });
});

describe('sortByProbe', () => {
  const known: Record<string, ProbeChannelResult> = {
    best: make('best', { height: 720, fps: 50, video_bitrate_kbps: 3000 }),
    ok: make('ok', { height: 1080, fps: 25, video_bitrate_kbps: 5000 }),
    dead: make('dead', { status: 'dead' }),
    quiet: make('quiet', { height: 1080, fps: 60, video_bitrate_kbps: 10 }),
  };
  const lookup = (id: string) => known[id];

  it('orders alive ranked, then unprobed in original order, then dead / no signal', () => {
    const out = sortByProbe(['u1', 'dead', 'ok', 'u2', 'quiet', 'best', 'u3'], lookup);
    expect(out).toEqual(['best', 'ok', 'u1', 'u2', 'u3', 'dead', 'quiet']);
  });

  it('never drops items and does not mutate its input', () => {
    const input = ['dead', 'u1', 'best'];
    const out = sortByProbe(input, lookup);
    expect(out).toHaveLength(3);
    expect(input).toEqual(['dead', 'u1', 'best']);
  });

  it('keeps the original order when nothing is probed', () => {
    expect(sortByProbe(['c', 'a', 'b'], () => undefined)).toEqual(['c', 'a', 'b']);
  });
});

describe('classifyTier', () => {
  it('trusts RAW / 4K / UHD name markers', () => {
    expect(classifyTier(make('a', { name: 'ESPN RAW', height: 1080, video_bitrate_kbps: 800 }))).toBe('direct');
    expect(classifyTier(make('b', { name: 'ESPN ᴿᴬᵂ' }))).toBe('direct');
    expect(classifyTier(make('c', { name: 'Sky Sports 4K' }))).toBe('direct');
    expect(classifyTier(make('d', { name: 'DAZN UHD' }))).toBe('direct');
  });

  it('does not match markers inside other words', () => {
    expect(classifyTier(make('e', { name: 'Draw TV' }))).toBe('unknown');
  });

  it('uses bitrate relative to resolution when the name has no marker', () => {
    expect(classifyTier(make('f', { height: 1080, video_bitrate_kbps: 7000 }))).toBe('direct');
    expect(classifyTier(make('g', { height: 1080, video_bitrate_kbps: 2000 }))).toBe('restream');
  });

  it('is unknown without enough data', () => {
    expect(classifyTier(make('h', { height: 1080 }))).toBe('unknown');
  });
});

describe('display helpers', () => {
  it('buckets resolution and labels it', () => {
    expect(resolutionClass(2160)).toBe('4k');
    expect(resolutionClass(1080)).toBe('1080');
    expect(resolutionClass(720)).toBe('720');
    expect(resolutionClass(576)).toBe('sd');
    expect(resolutionLabel(2160)).toBe('4K');
    expect(resolutionLabel(1080)).toBe('1080p');
    expect(resolutionLabel(480)).toBe('SD');
  });

  it('scales fps and bitrate', () => {
    expect(fpsClass(60)).toBe('good');
    expect(fpsClass(50)).toBe('good');
    expect(fpsClass(35)).toBe('mid');
    expect(fpsClass(25)).toBe('low');
    expect(bitrateClass(6000)).toBe('good');
    expect(bitrateClass(2000)).toBe('mid');
    expect(bitrateClass(300)).toBe('low');
  });

  it('estimates remaining time from the average per probe', () => {
    expect(estimateRemainingSeconds(30, 0, 10)).toBeNull();
    expect(estimateRemainingSeconds(30, 10, 10)).toBeNull();
    expect(estimateRemainingSeconds(30, 5, 15)).toBe(60);
  });

  it('formats durations', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
