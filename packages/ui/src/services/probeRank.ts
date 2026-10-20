/**
 * probeRank.ts
 *
 * Pure ranking and tier logic for the Sports "Probe & rank" view. No I/O and
 * no Tauri imports, so it is unit-testable on its own.
 *
 * The tier badge is a HEURISTIC best guess, not a fact: a stream is called
 * "direct" when its name carries a RAW/4K/UHD marker or its video bitrate is
 * at least what is typical for its resolution, and "likely restream" when the
 * bitrate is below that typical figure. Providers do not expose this, so
 * treat it as a hint only.
 */

import type { ProbeChannelResult } from './stream-probe';

/** Frame rate at or above which a stream counts as high frame rate. */
export const HIGH_FPS_MIN = 50;
/** Streams with a measured video bitrate below this (kbps) are "no signal". */
export const NO_SIGNAL_KBPS = 100;
/** Display-only: fps at or below this is coloured as low in the badge. */
export const LOW_FPS_MAX = 30;

export type RankBucket = 'ranked' | 'pending' | 'dead';
export type RankTier = 'direct' | 'restream' | 'unknown';

export interface RankedGroups {
  ranked: ProbeChannelResult[];
  pending: ProbeChannelResult[];
  dead: ProbeChannelResult[];
}

// Name markers that suggest an untouched/original feed
const DIRECT_NAME_MARKER = /(?:^|[^a-z0-9])(?:raw|4k|uhd)(?:$|[^a-z0-9])|ᴿᴬᵂ/i;

/** Video bitrate (kbps) a direct feed typically reaches at a given height. */
export function expectedBitrateKbps(height: number): number {
  if (height >= 2160) return 12000;
  if (height >= 1080) return 6000;
  if (height >= 720) return 3000;
  if (height >= 480) return 1200;
  return 500;
}

/** Measured video bitrate in kbps, falling back to the overall bitrate. */
export function effectiveVideoBitrate(r: ProbeChannelResult): number | undefined {
  const v = r.video_bitrate_kbps;
  if (typeof v === 'number' && v > 0) return v;
  const total = r.bitrate_kbps;
  if (typeof total === 'number' && total > 0) return total;
  return undefined;
}

export function isDeadStatus(r: ProbeChannelResult): boolean {
  return r.status === 'dead' || r.status === 'geoblocked' || r.status === 'drm' || r.status === 'placeholder';
}

/** Connected, but the measured video bitrate is too low to be a picture. */
export function isNoSignal(r: ProbeChannelResult): boolean {
  const vb = r.video_bitrate_kbps;
  return typeof vb === 'number' && vb > 0 && vb < NO_SIGNAL_KBPS;
}

export function classifyTier(r: ProbeChannelResult): RankTier {
  if (DIRECT_NAME_MARKER.test(r.name || '')) return 'direct';
  const height = r.height;
  const bitrate = effectiveVideoBitrate(r);
  if (typeof height !== 'number' || height <= 0 || bitrate === undefined) return 'unknown';
  return bitrate >= expectedBitrateKbps(height) ? 'direct' : 'restream';
}

export function bucketOf(r: ProbeChannelResult): RankBucket {
  if (r.status === 'pending' || r.status === 'probing') return 'pending';
  if (isDeadStatus(r) || isNoSignal(r)) return 'dead';
  return 'ranked';
}

/** High frame rate (>= 50 fps) first, then height desc, then bitrate desc, then name. */
export function compareRank(a: ProbeChannelResult, b: ProbeChannelResult): number {
  const dg = Number((b.fps ?? 0) >= HIGH_FPS_MIN) - Number((a.fps ?? 0) >= HIGH_FPS_MIN);
  if (dg !== 0) return dg;
  const dh = (b.height ?? 0) - (a.height ?? 0);
  if (dh !== 0) return dh;
  const db = (effectiveVideoBitrate(b) ?? 0) - (effectiveVideoBitrate(a) ?? 0);
  if (db !== 0) return db;
  return (a.name || '').localeCompare(b.name || '');
}

export function rankResults(results: ProbeChannelResult[]): RankedGroups {
  const groups: RankedGroups = { ranked: [], pending: [], dead: [] };
  for (const r of results) {
    groups[bucketOf(r)].push(r);
  }
  groups.ranked.sort(compareRank);
  groups.dead.sort(compareRank);
  return groups;
}

/**
 * Stable sort for channel lists (search results, pickers): alive ranked
 * streams first, unprobed in their original order in the middle, dead and
 * no-signal last. Never removes anything. `lookup` returns the known probe
 * result for an item, or undefined when it has not been probed.
 */
export function sortByProbe<T>(items: T[], lookup: (item: T) => ProbeChannelResult | undefined): T[] {
  const tagged = items.map((item, index) => {
    const r = lookup(item);
    const bucket: RankBucket | null = r ? bucketOf(r) : null;
    const tier = bucket === 'ranked' ? 0 : bucket === 'dead' ? 2 : 1;
    return { item, index, r, tier };
  });
  tagged.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier === 0 && a.r && b.r) {
      const c = compareRank(a.r, b.r);
      if (c !== 0) return c;
    }
    return a.index - b.index;
  });
  return tagged.map((x) => x.item);
}

export type ResolutionClass = '4k' | '1080' | '720' | 'sd';
export type ScaleClass = 'good' | 'mid' | 'low';

/** Colour bucket for a stream height. */
export function resolutionClass(height: number): ResolutionClass {
  if (height >= 2160) return '4k';
  if (height >= 1080) return '1080';
  if (height >= 720) return '720';
  return 'sd';
}

/** Short badge label for a stream height. */
export function resolutionLabel(height: number): string {
  const cls = resolutionClass(height);
  if (cls === '4k') return '4K';
  if (cls === 'sd') return 'SD';
  return `${cls}p`;
}

export function fpsClass(fps: number): ScaleClass {
  if (fps >= 50) return 'good';
  if (fps > LOW_FPS_MAX) return 'mid';
  return 'low';
}

export function bitrateClass(kbps: number): ScaleClass {
  if (kbps >= 4000) return 'good';
  if (kbps >= 1500) return 'mid';
  return 'low';
}

/** Remaining seconds, extrapolated from the average time per finished probe. */
export function estimateRemainingSeconds(elapsedSec: number, done: number, total: number): number | null {
  if (done <= 0 || done >= total || elapsedSec <= 0) return null;
  return Math.round((elapsedSec / done) * (total - done));
}

/** m:ss, or h:mm:ss from an hour up. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
