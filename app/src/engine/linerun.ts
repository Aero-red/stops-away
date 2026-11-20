import type { Network } from './types';

/** Line Run: name every station on one line before the clock runs out. */

/** The clock fits the line: 20 s to get going plus 8 s a station, rounded to 5 s. */
export function runSeconds(stations: number): number {
  return Math.round((20 + 8 * stations) / 5) * 5;
}

export interface RunState { line: string; startedAt: number; seconds: number; found: string[]; misses: number; doneAt: number | null }

export function lineStations(net: Network, line: string): string[] {
  return net.stations.filter((s) => s.lines.includes(line)).map((s) => s.id);
}

export function runStart(net: Network, line: string, now: number): RunState {
  return { line, startedAt: now, seconds: runSeconds(lineStations(net, line).length), found: [], misses: 0, doneAt: null };
}

const timeUp = (s: RunState, now: number) => now - s.startedAt >= s.seconds * 1000;

/** Milliseconds left on the clock; frozen once the run is done. */
export function runLeft(s: RunState, now: number): number {
  return Math.max(0, s.seconds * 1000 - ((s.doneAt ?? now) - s.startedAt));
}

/** Stations on the line not named. */
export function runMissed(net: Network, s: RunState): string[] {
  return lineStations(net, s.line).filter((id) => !s.found.includes(id));
}

export function runGiveUp(s: RunState, now: number): RunState {
  return s.doneAt !== null ? s : { ...s, doneAt: now };
}

export function runOver(s: RunState, now: number): boolean {
  return s.doneAt !== null || timeUp(s, now);
}

export function runGuess(net: Network, s: RunState, id: string, now: number):
  { result: 'found' | 'again' | 'miss' | 'over'; state: RunState } {
  if (runOver(s, now)) return { result: 'over', state: s };
  const on = lineStations(net, s.line);
  if (!on.includes(id)) return { result: 'miss', state: { ...s, misses: s.misses + 1 } };
  if (s.found.includes(id)) return { result: 'again', state: s };
  const found = [...s.found, id];
  return { result: 'found', state: { ...s, found, doneAt: found.length === on.length ? now : null } };
}

const clock = (ms: number) => { const t = Math.round(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export function runShare(net: Network, s: RunState, now: number): string {
  const name = net.lines.find((l) => l.id === s.line)?.name ?? s.line;
  const total = lineStations(net, s.line).length;
  const took = Math.min((s.doneAt ?? now) - s.startedAt, s.seconds * 1000);
  return `Stops Away Line Run · ${name} line · ${s.found.length}/${total} · ${clock(took)}`;
}

