import { describe, it, expect } from 'vitest';
import { mergeAllMatches } from '../searchMerge';
import type { ProbeChannelResult } from '../stream-probe';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const H = 3600_000;

const ch = (id: string, name = `Chan ${id}`) => ({ stream_id: id, name });
const prog = (id: string, startH: number, endH: number) => ({
  id,
  start: new Date(NOW + startH * H),
  end: new Date(NOW + endH * H),
});

function probe(id: string, over: Partial<ProbeChannelResult> = {}): ProbeChannelResult {
  return { stream_id: id, source_id: 's', name: id, url: '', status: 'alive', ...over };
}

const run = (
  over: Partial<Parameters<typeof mergeAllMatches<ReturnType<typeof ch>>>[0]> = {}
) =>
  mergeAllMatches({
    nameChannels: [],
    programEntries: [],
    nowMs: NOW,
    lookup: () => undefined,
    sort: 'smart',
    ...over,
  });

describe('mergeAllMatches', () => {
  it('orders live EPG, upcoming EPG, then name-only', () => {
    const out = run({
      nameChannels: [ch('n1'), ch('n2')],
      programEntries: [
        { channel: ch('up'), programs: [prog('p1', 2, 4)] },
        { channel: ch('live'), programs: [prog('p2', -1, 1)] },
      ],
    });
    expect(out.map((e) => [e.channel.stream_id, e.group])).toEqual([
      ['live', 'live'],
      ['up', 'upcoming'],
      ['n1', 'name'],
      ['n2', 'name'],
    ]);
  });

  it('dedupes a channel that matches by name and by programme', () => {
    const out = run({
      nameChannels: [ch('a'), ch('b')],
      programEntries: [{ channel: ch('a'), programs: [prog('p', 1, 2)] }],
    });
    expect(out.map((e) => e.channel.stream_id)).toEqual(['a', 'b']);
    expect(out[0].group).toBe('upcoming');
    expect(out[0].matchedProgramIds).toEqual(['p']);
  });

  it('ignores programmes that already ended', () => {
    const out = run({
      nameChannels: [ch('a')],
      programEntries: [{ channel: ch('a'), programs: [prog('old', -3, -1)] }],
    });
    expect(out[0].group).toBe('name');
    expect(out[0].matchedProgramIds).toEqual([]);
  });

  it('ranks by probe inside a group with dead streams last', () => {
    const results: Record<string, ProbeChannelResult> = {
      dead: probe('dead', { status: 'dead' }),
      hd: probe('hd', { height: 1080, fps: 50, video_bitrate_kbps: 5000 }),
      sd: probe('sd', { height: 480, fps: 25, video_bitrate_kbps: 1000 }),
    };
    const out = run({
      programEntries: [
        { channel: ch('dead'), programs: [prog('a', -1, 1)] },
        { channel: ch('sd'), programs: [prog('b', -1, 1)] },
        { channel: ch('hd'), programs: [prog('c', -1, 1)] },
      ],
      lookup: (c) => results[c.stream_id],
    });
    expect(out.map((e) => e.channel.stream_id)).toEqual(['hd', 'sd', 'dead']);
  });

  it('name sort is alphabetical across groups; quality sort ignores groups', () => {
    const input = {
      nameChannels: [ch('z', 'Zed')],
      programEntries: [{ channel: ch('m', 'Mid'), programs: [prog('p', -1, 1)] }],
    };
    expect(run({ ...input, sort: 'name' }).map((e) => e.channel.name)).toEqual(['Mid', 'Zed']);
    const results = { z: probe('z', { height: 1080, fps: 50, video_bitrate_kbps: 5000 }) };
    const q = run({ ...input, sort: 'quality', lookup: (c) => (results as any)[c.stream_id] });
    expect(q.map((e) => e.channel.stream_id)).toEqual(['z', 'm']);
  });
});
