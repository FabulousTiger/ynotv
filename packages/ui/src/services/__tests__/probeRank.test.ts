/**
 * Sports "Probe & rank" ordering and tier heuristic (probeRank.ts).
 *
 * Streams sort by height, then fps, then bitrate. Low fps / low bitrate
 * streams sink to their own section rather than disappearing, and dead
 * streams always come last.
 */
import { describe, it, expect } from 'vitest';
import {
  rankResults,
  classifyTier,
  isLowQuality,
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
  it('sorts by height, then fps, then bitrate (all descending)', () => {
    const groups: RankedGroups = rankResults([
      make('a', { height: 720, fps: 60, video_bitrate_kbps: 5000 }),
      make('b', { height: 1080, fps: 50, video_bitrate_kbps: 4000 }),
      make('c', { height: 1080, fps: 60, video_bitrate_kbps: 3000 }),
      make('d', { height: 1080, fps: 60, video_bitrate_kbps: 6000 }),
    ]);
    expect(ids(groups.ranked)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('moves fps <= 30 and bitrate < 100 kbps into low quality, not out of the list', () => {
    const groups = rankResults([
      make('hi', { height: 720, fps: 60, video_bitrate_kbps: 3000 }),
      make('slow', { height: 1080, fps: 30, video_bitrate_kbps: 5000 }),
      make('ntsc', { height: 1080, fps: 29.97, video_bitrate_kbps: 5000 }),
      make('starved', { height: 1080, fps: 60, video_bitrate_kbps: 90 }),
    ]);
    expect(ids(groups.ranked)).toEqual(['hi']);
    expect(ids(groups.low)).toEqual(['starved', 'slow', 'ntsc']);
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

  it('does not treat unknown fps or bitrate as low quality', () => {
    expect(isLowQuality(make('x', { height: 1080 }))).toBe(false);
    expect(isLowQuality(make('y', { fps: 31, video_bitrate_kbps: 100 }))).toBe(false);
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
