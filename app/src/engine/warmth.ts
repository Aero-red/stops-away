import type { Feedback } from './modes/types';

/** How each guess compares with the best guess before it (user decision 2026-11-19, LOTUS-037). */
export type Warmth = 'first' | 'warmer' | 'colder' | 'same' | 'hit';

/** Share-card squares: never colour words, never station names. */
export const WARMTH_SQUARE: Record<Warmth, string> = { first: '⬜', warmer: '🟧', colder: '🟦', same: '⬜', hit: '🟩' };

export function warmth(guesses: Feedback[]): Warmth[] {
  let best = Infinity;
  return guesses.map((g, i) => {
    if (g.correct) return 'hit';
    const stops = g.route?.stops ?? Infinity;
    const w: Warmth = i === 0 ? 'first' : stops < best ? 'warmer' : stops > best ? 'colder' : 'same';
    best = Math.min(best, stops);
    return w;
  });
}
