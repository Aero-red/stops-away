import type { Network } from './types';

/** A practice target, from one line when the player picked a theme. */
export function practiceTarget(net: Network, line: string | null, rand: () => number): string {
  const pool = line ? net.stations.filter((s) => s.lines.includes(line)) : net.stations;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))].id;
}
