/**
 * downloadNaming.ts
 *
 * Pure title cleanup and Windows download path building. No I/O, no store or
 * Tauri imports, so it is unit-testable on its own.
 */

export const DOWNLOAD_DESTINATIONS = ['Series', 'Anime', 'Movies', 'Movies-4K', 'Anime-Movies'] as const;
export type DownloadDestination = (typeof DOWNLOAD_DESTINATIONS)[number];
export type DownloadContentType = 'series' | 'movie';

export const DEFAULT_DOWNLOADS_ROOT = 'H:\\Downloads\\ynoTV';
export const DEFAULT_DESTINATION: Record<DownloadContentType, DownloadDestination> = {
  series: 'Series',
  movie: 'Movies',
};
/** Longest allowed name for a single path component (without extension). */
export const MAX_COMPONENT_LENGTH = 120;

// Provider prefix: "XX - " or "4K-XX - ", 2-5 chars of A-Z0-9+, optional hyphenated part (NF-DO)
const PREFIX = /^(?:4K-)?[A-Z0-9+]{2,5}(?:-[A-Z0-9+]{2,5})?\s*-\s+(?=\S)/;
// A second prefix is only stripped when it is exactly two letters (a language code)
const SECOND_PREFIX = /^[A-Z]{2}\s*-\s+(?=\S)/;
const YEAR = /\((?:19|20)\d\d\)/;
const QUALITY_TAG = /\s*\((?:FHD|HD|UHD|4K)\)/g;
const TRAILING_COUNTRY = /\s*\([A-Z]{2}\)\s*$/;
const TRAILING_4K = /\s+4K$/;
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** First four-digit year (1900-2099) in a year or release date value. */
export function yearFromMeta(year?: string | number | null, releaseDate?: string | null): string | null {
  for (const value of [year, releaseDate]) {
    if (value === undefined || value === null) continue;
    const m = String(value).match(/(?:19|20)\d\d/);
    if (m) return m[0];
  }
  return null;
}

/** Windows-safe text: ': ' becomes ' - ', other illegal characters become '_'. */
export function sanitizeSegment(text: string): string {
  return text
    .replace(/:\s+/g, ' - ')
    .replace(ILLEGAL_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

/**
 * Provider title to "Name (Year)". Strips provider prefixes, quality tags and
 * everything after the first (YYYY). Without a year in the title, `fallbackYear`
 * (from stored metadata) is used; with neither, the plain name is returned.
 */
export function cleanTitle(raw: string, fallbackYear?: string | number | null): string {
  let t = raw.trim();
  const afterFirst = t.replace(PREFIX, '');
  if (afterFirst !== t) {
    t = afterFirst.replace(SECOND_PREFIX, '');
  }

  let out: string;
  const m = YEAR.exec(t);
  if (m) {
    const name = t
      .slice(0, m.index)
      .replace(QUALITY_TAG, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(TRAILING_4K, '');
    out = `${name} ${m[0]}`;
  } else {
    const name = t.replace(QUALITY_TAG, '').replace(TRAILING_COUNTRY, '').replace(/\s+/g, ' ').trim();
    const year = yearFromMeta(fallbackYear);
    out = year ? `${name} (${year})` : name;
  }

  const cleaned = sanitizeSegment(out);
  return cleaned || sanitizeSegment(raw) || 'Untitled';
}

/** Cap a file stem or folder name, trimming any trailing dot or space left by the cut. */
export function capComponent(name: string, max: number = MAX_COMPONENT_LENGTH): string {
  return name.length > max ? name.slice(0, max).replace(/[. ]+$/, '') : name;
}

/** Download root with backslashes and no trailing separator; falls back to the default root. */
export function resolveDownloadsRoot(downloadsPath?: string | null): string {
  const trimmed = (downloadsPath ?? '').trim().replace(/\//g, '\\').replace(/\\+$/, '');
  return trimmed || DEFAULT_DOWNLOADS_ROOT;
}

export function isDownloadDestination(value: unknown): value is DownloadDestination {
  return typeof value === 'string' && (DOWNLOAD_DESTINATIONS as readonly string[]).includes(value);
}

function pad2(n: number): string {
  return String(Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0).padStart(2, '0');
}

function joinWin(...parts: string[]): string {
  return parts.join('\\');
}

export interface SeriesPathInput {
  root: string;
  destination: DownloadDestination;
  showTitle: string;
  showYear?: string | number | null;
  season: number;
  episode: number;
  episodeTitle?: string | null;
  ext: string;
  /** When false the file goes straight into the destination folder. */
  organizeByFolder?: boolean;
}

/** `<root>\<Dest>\<Show (Year)>\Season 01\<Show (Year)> - S01E02 - <Episode Title>.<ext>` */
export function buildSeriesEpisodePath(input: SeriesPathInput): string {
  const show = cleanTitle(input.showTitle, input.showYear);
  const epTitle = sanitizeSegment(input.episodeTitle ?? '');
  const tag = `S${pad2(input.season)}E${pad2(input.episode)}`;
  const stem = capComponent(epTitle ? `${show} - ${tag} - ${epTitle}` : `${show} - ${tag}`);
  const root = resolveDownloadsRoot(input.root);
  const base = joinWin(root, input.destination);
  const dir =
    input.organizeByFolder === false
      ? base
      : joinWin(base, capComponent(show), `Season ${pad2(input.season)}`);
  return joinWin(dir, `${stem}.${input.ext}`);
}

export interface MoviePathInput {
  root: string;
  destination: DownloadDestination;
  title: string;
  year?: string | number | null;
  ext: string;
}

/** `<root>\<Dest>\<Name (Year)>\<Name (Year)>.<ext>` */
export function buildMoviePath(input: MoviePathInput): string {
  const name = capComponent(cleanTitle(input.title, input.year));
  return joinWin(resolveDownloadsRoot(input.root), input.destination, name, `${name}.${input.ext}`);
}

/** Folder preview used by the series download dialog. */
export function buildSeriesFolderPreview(
  root: string,
  destination: DownloadDestination,
  showTitle: string,
  showYear: string | number | null | undefined,
  seasonLabel: string,
  organizeByFolder: boolean
): string {
  const base = joinWin(resolveDownloadsRoot(root), destination);
  if (!organizeByFolder) return `${base}\\`;
  return `${joinWin(base, capComponent(cleanTitle(showTitle, showYear)), seasonLabel)}\\`;
}

/** Container for the download: HLS streams are remuxed to mkv, everything else is mp4. */
export function downloadExtension(url: string): 'mkv' | 'mp4' {
  return url.includes('.m3u8') || url.includes('/mono.m3u8') ? 'mkv' : 'mp4';
}
