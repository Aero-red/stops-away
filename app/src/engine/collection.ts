import type { Network } from './types';

/** Every station a player has met, kept in the browser: seen (guessed, passed, named) and found. */
export interface Collection { seen: string[]; found: string[] }

export const emptyCollection = (): Collection => ({ seen: [], found: [] });

export function record(c: Collection, seen: string[], found: string | null): Collection {
  const s = new Set([...c.seen, ...seen, ...(found ? [found] : [])]);
  const f = new Set([...c.found, ...(found ? [found] : [])]);
  return { seen: [...s], found: [...f] };
}

export function lineProgress(c: Collection, net: Network) {
  const seen = new Set(c.seen), found = new Set(c.found);
  return net.lines.map((l) => {
    const on = net.stations.filter((s) => s.lines.includes(l.id));
    return { line: l.id, name: l.name, colour: l.colour, total: on.length,
             seen: on.filter((s) => seen.has(s.id)).length, found: on.filter((s) => found.has(s.id)).length };
  });
}
