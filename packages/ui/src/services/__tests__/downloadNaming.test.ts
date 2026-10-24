/**
 * Provider title cleanup and download path building (downloadNaming.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOWNLOADS_ROOT,
  MAX_COMPONENT_LENGTH,
  buildMoviePath,
  buildSeriesEpisodePath,
  buildSeriesFolderPreview,
  capComponent,
  cleanTitle,
  downloadExtension,
  isDownloadDestination,
  resolveDownloadsRoot,
  sanitizeSegment,
  yearFromMeta,
} from '../downloadNaming';

describe('cleanTitle (real provider titles)', () => {
  const cases: Array<[string, string]> = [
    ['EN - Taskmaster (2015)', 'Taskmaster (2015)'],
    ['NF - Arcane 4K (2021) (US)', 'Arcane (2021)'],
    ['EN - The Brutalist (2024) (MULTI SUB)', 'The Brutalist (2024)'],
    ['4K-TOP - Practical Magic 2 (2026)', 'Practical Magic 2 (2026)'],
    ['Dark Hearts (2023) (FR)', 'Dark Hearts (2023)'],
    ['NF - NL - Annabelle Comes Home (2019)', 'Annabelle Comes Home (2019)'],
    ['EN - BMF - Black Mafia Family (2021)', 'BMF - Black Mafia Family (2021)'],
    ['4K-NF - 13 Reasons Why (US)', '13 Reasons Why'],
    ['NF - Annabelle: Creation', 'Annabelle - Creation'],
    ['EN - Suits (FHD) (2011) (US)', 'Suits (2011)'],
    ['TOP - Mute', 'Mute'],
  ];
  it.each(cases)('%s -> %s', (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });

  it('keeps longer second prefixes such as LOL and CHSLD', () => {
    expect(cleanTitle('EN - LOL - Last One Laughing (2021)')).toBe('LOL - Last One Laughing (2021)');
    expect(cleanTitle('FR - CHSLD - Series (2020)')).toBe('CHSLD - Series (2020)');
  });

  it('strips hyphenated prefixes like NF-DO', () => {
    expect(cleanTitle('NF-DO - Some Show (2020)')).toBe('Some Show (2020)');
  });

  it('uses the stored year only when the title has none', () => {
    expect(cleanTitle('4K-NF - 13 Reasons Why (US)', '2017')).toBe('13 Reasons Why (2017)');
    expect(cleanTitle('EN - Suits (2011)', '1999')).toBe('Suits (2011)');
    expect(cleanTitle('TOP - Mute', 2018)).toBe('Mute (2018)');
    expect(cleanTitle('TOP - Mute', 'n/a')).toBe('Mute');
  });

  it('drops tags without a year and replaces illegal characters', () => {
    expect(cleanTitle('EN - Some Movie (FHD)')).toBe('Some Movie');
    expect(cleanTitle('What? Who*Is|This')).toBe('What_ Who_Is_This');
    expect(cleanTitle('Trailing dot... ')).toBe('Trailing dot');
  });

  it('never returns an empty name', () => {
    expect(cleanTitle('   ')).toBe('Untitled');
  });
});

describe('yearFromMeta', () => {
  it('reads a year or the year of a release date', () => {
    expect(yearFromMeta('2011')).toBe('2011');
    expect(yearFromMeta(undefined, '2019-03-04')).toBe('2019');
    expect(yearFromMeta('', '2019-03-04')).toBe('2019');
    expect(yearFromMeta(undefined, undefined)).toBeNull();
  });
});

describe('sanitizeSegment / capComponent', () => {
  it('maps ": " to " - " and other illegal characters to underscores', () => {
    expect(sanitizeSegment('A: B')).toBe('A - B');
    expect(sanitizeSegment('A<B>C')).toBe('A_B_C');
  });

  it('caps at 120 characters and re-trims', () => {
    expect(MAX_COMPONENT_LENGTH).toBe(120);
    const long = 'a'.repeat(119) + ' ' + 'b'.repeat(30);
    const capped = capComponent(long);
    expect(capped.length).toBeLessThanOrEqual(120);
    expect(capped.endsWith(' ')).toBe(false);
    expect(capComponent('short')).toBe('short');
  });
});

describe('download paths', () => {
  it('builds the series episode path with zero-padded numbers', () => {
    expect(
      buildSeriesEpisodePath({
        root: 'H:\\Downloads\\ynoTV',
        destination: 'Anime',
        showTitle: 'EN - Suits (2011) (US)',
        season: 1,
        episode: 2,
        episodeTitle: 'Errors & Omissions: Part 2',
        ext: 'mkv',
      })
    ).toBe(
      'H:\\Downloads\\ynoTV\\Anime\\Suits (2011)\\Season 01\\Suits (2011) - S01E02 - Errors & Omissions - Part 2.mkv'
    );
  });

  it('omits the episode title when unavailable and uses the stored year', () => {
    expect(
      buildSeriesEpisodePath({
        root: 'H:\\Downloads\\ynoTV\\',
        destination: 'Series',
        showTitle: 'NF - Arcane',
        showYear: '2021',
        season: 12,
        episode: 103,
        ext: 'mp4',
      })
    ).toBe('H:\\Downloads\\ynoTV\\Series\\Arcane (2021)\\Season 12\\Arcane (2021) - S12E103.mp4');
  });

  it('can skip the show and season folders', () => {
    expect(
      buildSeriesEpisodePath({
        root: 'D:\\dl',
        destination: 'Series',
        showTitle: 'Show (2020)',
        season: 1,
        episode: 1,
        ext: 'mp4',
        organizeByFolder: false,
      })
    ).toBe('D:\\dl\\Series\\Show (2020) - S01E01.mp4');
  });

  it('builds the movie path', () => {
    expect(
      buildMoviePath({
        root: 'H:\\Downloads\\ynoTV',
        destination: 'Movies-4K',
        title: '4K-TOP - Practical Magic 2 (2026)',
        ext: 'mp4',
      })
    ).toBe('H:\\Downloads\\ynoTV\\Movies-4K\\Practical Magic 2 (2026)\\Practical Magic 2 (2026).mp4');
  });

  it('caps the final component near 120 characters', () => {
    const path = buildMoviePath({
      root: 'D:\\dl',
      destination: 'Movies',
      title: 'x'.repeat(300),
      ext: 'mp4',
    });
    const file = path.split('\\').pop() as string;
    expect(file.length).toBeLessThanOrEqual(120 + '.mp4'.length);
  });

  it('previews the folder', () => {
    expect(buildSeriesFolderPreview('D:\\dl', 'Anime', 'EN - Suits (2011)', undefined, 'Season 01', true)).toBe(
      'D:\\dl\\Anime\\Suits (2011)\\Season 01\\'
    );
    expect(buildSeriesFolderPreview('D:\\dl', 'Anime', 'Suits', undefined, 'Season 01', false)).toBe('D:\\dl\\Anime\\');
  });
});

describe('root and destination helpers', () => {
  it('falls back to the default root and normalises separators', () => {
    expect(resolveDownloadsRoot('')).toBe(DEFAULT_DOWNLOADS_ROOT);
    expect(resolveDownloadsRoot(undefined)).toBe(DEFAULT_DOWNLOADS_ROOT);
    expect(resolveDownloadsRoot('E:/Media/dl/')).toBe('E:\\Media\\dl');
  });

  it('validates destinations', () => {
    expect(isDownloadDestination('Anime-Movies')).toBe(true);
    expect(isDownloadDestination('Music')).toBe(false);
    expect(isDownloadDestination(undefined)).toBe(false);
  });

  it('picks mkv for HLS and mp4 otherwise', () => {
    expect(downloadExtension('http://x/stream.m3u8?a=1')).toBe('mkv');
    expect(downloadExtension('http://x/movie.mp4')).toBe('mp4');
  });

  it('keeps the container of direct streams', () => {
    expect(downloadExtension('http://x/series/u/p/2090912.mkv')).toBe('mkv');
    expect(downloadExtension('http://x/a/b.AVI?token=1')).toBe('avi');
    expect(downloadExtension('http://x/a/b/123')).toBe('mp4');
  });

  it('strips the echoed provider title from episode titles', () => {
    expect(
      buildSeriesEpisodePath({
        root: 'H:\\Downloads\\ynoTV',
        destination: 'Series',
        showTitle: 'EN - Game Changer (2019) (US)',
        season: 6,
        episode: 9,
        episodeTitle: 'EN - Game Changer (2019) (US) - S06E09 - Ratfish (2)',
        ext: 'mkv',
      })
    ).toBe(
      'H:\\Downloads\\ynoTV\\Series\\Game Changer (2019)\\Season 06\\Game Changer (2019) - S06E09 - Ratfish (2).mkv'
    );
  });
});
