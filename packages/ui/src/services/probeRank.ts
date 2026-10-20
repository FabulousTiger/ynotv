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

/** Streams at or below this frame rate sink to the low quality section. */
export const LOW_FPS_MAX = 30;
/** Streams with a measured video bitrate below this (kbps) are low quality. */
export const LOW_BITRATE_KBPS = 100;

export type RankBucket = 'ranked' | 'low' | 'pending' | 'dead';
export type RankTier = 'direct' | 'restream' | 'unknown';

export interface RankedGroups {
  ranked: ProbeChannelResult[];
  low: ProbeChannelResult[];
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

export function isLowQuality(r: ProbeChannelResult): boolean {
  if (typeof r.fps === 'number' && r.fps > 0 && r.fps <= LOW_FPS_MAX) return true;
  const vb = r.video_bitrate_kbps;
  return typeof vb === 'number' && vb > 0 && vb < LOW_BITRATE_KBPS;
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
  if (isDeadStatus(r)) return 'dead';
  return isLowQuality(r) ? 'low' : 'ranked';
}

/** Height desc, then fps desc, then bitrate desc, then name for stability. */
export function compareRank(a: ProbeChannelResult, b: ProbeChannelResult): number {
  const dh = (b.height ?? 0) - (a.height ?? 0);
  if (dh !== 0) return dh;
  const df = (b.fps ?? 0) - (a.fps ?? 0);
  if (df !== 0) return df;
  const db = (effectiveVideoBitrate(b) ?? 0) - (effectiveVideoBitrate(a) ?? 0);
  if (db !== 0) return db;
  return (a.name || '').localeCompare(b.name || '');
}

export function rankResults(results: ProbeChannelResult[]): RankedGroups {
  const groups: RankedGroups = { ranked: [], low: [], pending: [], dead: [] };
  for (const r of results) {
    groups[bucketOf(r)].push(r);
  }
  groups.ranked.sort(compareRank);
  groups.low.sort(compareRank);
  groups.dead.sort(compareRank);
  return groups;
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
