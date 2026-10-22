import type { StoredProgram } from '../db';

/** Programmes per channel row; a channel matching both ways keeps its full window. */
export function buildChannelProgramsMap(
  channelIds: string[],
  windowPrograms: StoredProgram[],
  programMatches: StoredProgram[],
  matchedChannelIds: Iterable<string>
): Map<string, StoredProgram[]> {
  const map = new Map<string, StoredProgram[]>();
  for (const id of channelIds) map.set(id, []);
  for (const prog of windowPrograms) map.get(prog.stream_id)?.push(prog);
  for (const streamId of matchedChannelIds) {
    if (!map.has(streamId)) map.set(streamId, programMatches.filter((p) => p.stream_id === streamId));
  }
  return map;
}
