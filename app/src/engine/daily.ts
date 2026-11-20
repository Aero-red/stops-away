import type { Station } from './types';

/** Game 1 is this date (UTC midnight, Melbourne day boundary handled by dayNumber). */
export const EPOCH = Date.UTC(2026, 0, 1);

/** Day number in Melbourne local time, so the puzzle changes at local midnight. */
export function dayNumber(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'));
  return Math.floor((local - EPOCH) / 86_400_000) + 1;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Target for a game number. Stations are shuffled once per cycle with a seeded
 * PRNG, so no station repeats until every station has been used.
 */
export function pickTarget(game: number, seed: number, stations: Station[]): Station {
  const ids = [...stations].sort((a, b) => a.id.localeCompare(b.id));
  const n = ids.length;
  const cycle = Math.floor((game - 1) / n);
  const rand = mulberry32(seed + cycle * 7919);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids[(((game - 1) % n) + n) % n];
}
