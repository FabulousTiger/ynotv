import { describe, it, expect } from 'vitest';
import { buildChannelProgramsMap } from '../searchPrograms';
import type { StoredProgram } from '../../db';

function prog(streamId: string, id: string): StoredProgram {
  return { stream_id: streamId, id, title: id } as unknown as StoredProgram;
}

describe('buildChannelProgramsMap', () => {
  it('keeps the full window for a channel matching both by name and programme', () => {
    const window = [prog('a', 'w1'), prog('a', 'w2'), prog('a', 'w3')];
    const matches = [prog('a', 'w2')];
    const map = buildChannelProgramsMap(['a'], window, matches, ['a']);
    expect(map.get('a')!.map((p) => p.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('uses the programme matches for a channel found only by programme', () => {
    const matches = [prog('b', 'm1'), prog('c', 'x')];
    const map = buildChannelProgramsMap(['a'], [], matches, ['b']);
    expect(map.get('b')!.map((p) => p.id)).toEqual(['m1']);
    expect(map.get('a')).toEqual([]);
  });
});
