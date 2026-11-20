/** Badges: small rewards for what just happened. Earned once each, kept in the browser. */
export const BADGES: { id: string; name: string; text: string }[] = [
  { id: 'first-win', name: 'First stop', text: 'Found your first hidden station.' },
  { id: 'one-guess', name: 'Straight there', text: 'Found the station with your first guess.' },
  { id: 'two-guesses', name: 'Express', text: 'Found the station in two guesses or fewer.' },
  { id: 'streak-3', name: 'Regular', text: 'Solved the daily three days in a row.' },
  { id: 'streak-7', name: 'Commuter', text: 'Solved the daily seven days in a row.' },
  { id: 'line-clear', name: 'End to end', text: 'Named every station on a line in Line Run.' },
  { id: 'par', name: 'On time', text: 'Finished a Connect at or under par.' },
  { id: 'duel-win', name: 'Platform rival', text: 'Beat a friend in a duel.' },
  { id: 'met-50', name: 'Explorer', text: 'Met 50 stations across your games.' },
  { id: 'met-100', name: 'Network nerd', text: 'Met 100 stations across your games.' },
];

export type Happened =
  | { kind: 'solved'; guesses: number; streak: number; met: number }
  | { kind: 'linerun'; complete: boolean; met: number }
  | { kind: 'connect'; moves: number; par: number; met: number }
  | { kind: 'duel'; verdict: 'win' | 'lose' | 'draw'; met: number };

export function earned(h: Happened, have: string[]): string[] {
  const got = new Set<string>();
  if (h.kind === 'solved') {
    got.add('first-win');
    if (h.guesses <= 1) got.add('one-guess');
    if (h.guesses <= 2) got.add('two-guesses');
    if (h.streak >= 3) got.add('streak-3');
    if (h.streak >= 7) got.add('streak-7');
  }
  if (h.kind === 'linerun' && h.complete) got.add('line-clear');
  if (h.kind === 'connect' && h.moves <= h.par) got.add('par');
  if (h.kind === 'duel' && h.verdict === 'win') got.add('duel-win');
  if (h.met >= 50) got.add('met-50');
  if (h.met >= 100) got.add('met-100');
  const owned = new Set(have);
  return BADGES.map((b) => b.id).filter((id) => got.has(id) && !owned.has(id));
}
