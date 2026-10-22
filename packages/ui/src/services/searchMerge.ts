// Pure merge/sort for the guide search "All" tab (name + programme matches).

import { sortByProbe } from './probeRank';
import type { ProbeChannelResult } from './stream-probe';

export type AllGroup = 'live' | 'upcoming' | 'name';
export type AllSort = 'smart' | 'name' | 'quality';

interface ChannelLike {
  stream_id: string;
  name: string;
  alias?: string;
}

interface ProgramLike {
  id: string;
  start: Date | string;
  end: Date | string;
}

export interface AllEntry<C extends ChannelLike> {
  channel: C;
  group: AllGroup;
  /** Ids of the programmes that matched the query (to highlight). */
  matchedProgramIds: string[];
}

const GROUP_ORDER: Record<AllGroup, number> = { live: 0, upcoming: 1, name: 2 };

const toMs = (d: Date | string): number => (d instanceof Date ? d.getTime() : new Date(d).getTime());

function displayName(c: ChannelLike): string {
  return c.alias || c.name;
}

export function mergeAllMatches<C extends ChannelLike>(opts: {
  nameChannels: C[];
  programEntries: { channel: C; programs: ProgramLike[] }[];
  nowMs: number;
  lookup: (channel: C) => ProbeChannelResult | undefined;
  sort: AllSort;
}): AllEntry<C>[] {
  const { nameChannels, programEntries, nowMs, lookup, sort } = opts;
  const byId = new Map<string, AllEntry<C>>();
  const earliest = new Map<string, number>();

  for (const { channel, programs } of programEntries) {
    const active = programs.filter((p) => toMs(p.end) > nowMs);
    if (active.length === 0) continue;
    const live = active.some((p) => toMs(p.start) <= nowMs);
    const existing = byId.get(channel.stream_id);
    const ids = active.map((p) => p.id);
    if (existing) {
      existing.matchedProgramIds.push(...ids.filter((id) => !existing.matchedProgramIds.includes(id)));
      if (live) existing.group = 'live';
    } else {
      byId.set(channel.stream_id, { channel, group: live ? 'live' : 'upcoming', matchedProgramIds: ids });
    }
    const start = Math.min(...active.map((p) => toMs(p.start)));
    earliest.set(channel.stream_id, Math.min(earliest.get(channel.stream_id) ?? Infinity, start));
  }

  for (const channel of nameChannels) {
    if (!byId.has(channel.stream_id)) byId.set(channel.stream_id, { channel, group: 'name', matchedProgramIds: [] });
  }

  // Programme matches ordered by earliest matched start, name matches keep their order
  const nameOrder = new Map(nameChannels.map((c, i) => [c.stream_id, i]));
  const epgSorted = [...byId.values()]
    .filter((e) => e.group !== 'name')
    .sort((a, b) => {
      const dg = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
      if (dg !== 0) return dg;
      return (earliest.get(a.channel.stream_id) ?? 0) - (earliest.get(b.channel.stream_id) ?? 0);
    });
  const nameOnly = [...byId.values()].filter((e) => e.group === 'name');
  nameOnly.sort((a, b) => (nameOrder.get(a.channel.stream_id) ?? 0) - (nameOrder.get(b.channel.stream_id) ?? 0));
  const ordered = [...epgSorted, ...nameOnly];

  const probe = (list: AllEntry<C>[]) => sortByProbe(list, (e) => lookup(e.channel));

  if (sort === 'name') {
    return ordered.sort((a, b) =>
      displayName(a.channel).localeCompare(displayName(b.channel), undefined, { sensitivity: 'base' })
    );
  }
  if (sort === 'quality') return probe(ordered);

  const out: AllEntry<C>[] = [];
  for (const group of ['live', 'upcoming', 'name'] as AllGroup[]) {
    out.push(...probe(ordered.filter((e) => e.group === group)));
  }
  return out;
}
