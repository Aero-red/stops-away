import type { Network } from './types';
import { shortestRoute } from './route';

/** Connect: get from one station to another by naming a neighbouring station each move. */
export interface ConnectState { from: string; to: string; par: number; path: string[]; hints: number }

export function neighbours(net: Network, id: string): string[] {
  const out = new Set<string>();
  for (const e of net.edges) {
    if (e.a === id) out.add(e.b);
    else if (e.b === id) out.add(e.a);
  }
  return [...out];
}

/** Fewest stops between two stations (changes don't matter in Connect). */
function hops(net: Network, from: string): Map<string, number> {
  const d = new Map([[from, 0]]);
  const q = [from];
  while (q.length) {
    const s = q.shift()!;
    for (const n of neighbours(net, s)) if (!d.has(n)) { d.set(n, d.get(s)! + 1); q.push(n); }
  }
  return d;
}

export function connectStart(net: Network, from: string, to: string): ConnectState {
  return { from, to, par: hops(net, from).get(to) ?? 0, path: [from], hints: 0 };
}

const limit = (s: ConnectState) => s.par * 2 + 4;
export const movesMade = (s: ConnectState) => s.path.length - 1;

export function connectOver(s: ConnectState): boolean {
  return s.path[s.path.length - 1] === s.to || movesMade(s) >= limit(s);
}

export type Trend = 'closer' | 'further' | 'same';

export function connectMove(net: Network, s: ConnectState, id: string):
  { ok: boolean; state: ConnectState; reason?: string; trend?: Trend } {
  if (connectOver(s)) return { ok: false, state: s, reason: 'over' };
  const here = s.path[s.path.length - 1];
  if (!neighbours(net, here).includes(id)) return { ok: false, state: s, reason: 'not next door' };
  // closer or further from the goal, in stops along the network
  const toGoal = hops(net, s.to);
  const before = toGoal.get(here) ?? Infinity, after = toGoal.get(id) ?? Infinity;
  const trend: Trend = after < before ? 'closer' : after > before ? 'further' : 'same';
  return { ok: true, state: { ...s, path: [...s.path, id] }, trend };
}

/** "Which way?": the next station on a shortest route from where you are. Costs a star. */
export function connectHint(net: Network, s: ConnectState): { next: string | null; state: ConnectState } {
  const here = s.path[s.path.length - 1];
  const toGoal = hops(net, s.to);
  const next = neighbours(net, here).filter((n) => (toGoal.get(n) ?? Infinity) < (toGoal.get(here) ?? Infinity))
    .sort()[0] ?? null;
  return { next, state: { ...s, hints: (s.hints ?? 0) + 1 } };
}

/** 3 stars at par, 2 within two moves of par, 1 for reaching it; minus one per hint, never below 1. */
export function stars(s: ConnectState): number {
  if (s.path[s.path.length - 1] !== s.to) return 0;
  const over = movesMade(s) - s.par;
  const base = over <= 0 ? 3 : over <= 2 ? 2 : 1;
  return Math.max(1, base - (s.hints ?? 0));
}

export function connectShare(s: ConnectState): string {
  const won = s.path[s.path.length - 1] === s.to;
  const m = movesMade(s);
  const head = won ? `Stops Away Connect · ${'★'.repeat(stars(s))} · ${m} moves (par ${s.par})` : `Stops Away Connect · not reached (par ${s.par})`;
  const bar = won ? (m <= s.par ? '🟩'.repeat(m) : '🟩'.repeat(s.par) + '🟧'.repeat(m - s.par)) : '⬛'.repeat(m);
  return `${head}\n${bar}`;
}

/** A start and goal 5 to 10 stops apart that need at least one change of line (a real puzzle,
 *  not a ride along one line). */
export function connectPair(net: Network, r1: () => number, r2: () => number): [string, string] {
  for (let tries = 0; tries < 50; tries++) {
    const a = net.stations[Math.floor(((r1() + tries * 0.618) % 1) * net.stations.length)].id;
    const d = hops(net, a);
    const ok = [...d].filter(([id, n]) => n >= 5 && n <= 10 && (shortestRoute(net, a, id)?.changes ?? 0) >= 1)
      .map(([id]) => id).sort();
    if (ok.length) return [a, ok[Math.min(ok.length - 1, Math.floor(r2() * ok.length))]];
  }
  return [net.stations[0].id, net.stations[1].id];
}


function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The day's Connect: the same pair for everyone, from the game number. */
export function connectDaily(net: Network, game: number): [string, string] {
  const r = mulberry32(game * 9973 + 20260101);
  return connectPair(net, r, r);
}
