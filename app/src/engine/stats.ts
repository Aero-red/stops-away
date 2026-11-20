import { HARD_MAX_GUESSES } from './score';

/** Daily-mode record kept in the browser. dist[i] = games solved in i+1 guesses. */
export interface Stats { played: number; wins: number; current: number; best: number; lastGame: number | null; dist: number[] }
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const emptyStats = (): Stats =>
  ({ played: 0, wins: 0, current: 0, best: 0, lastGame: null, dist: Array(HARD_MAX_GUESSES).fill(0) });

export function recordResult(s: Stats, game: number, solved: boolean, guesses: number): Stats {
  if (s.lastGame !== null && game <= s.lastGame) return s; // already counted
  const current = solved ? (s.lastGame === game - 1 ? s.current + 1 : 1) : 0;
  const dist = [...s.dist];
  if (solved) dist[guesses - 1] = (dist[guesses - 1] ?? 0) + 1;
  return { played: s.played + 1, wins: s.wins + (solved ? 1 : 0), current, best: Math.max(s.best, current), lastGame: game, dist };
}

/** Streak to show today: still alive if the last game was today or yesterday. */
export function shownStreak(s: Stats, today: number): number {
  return s.lastGame !== null && today - s.lastGame <= 1 ? s.current : 0;
}

// Browser storage can be missing, blocked or full: never let it break the game.
export function loadJSON<T>(kv: KV, key: string, fallback: T): T {
  try {
    const raw = kv.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJSON(kv: KV, key: string, value: unknown): void {
  try { kv.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: play on */ }
}
