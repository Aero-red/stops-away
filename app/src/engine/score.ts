import type { HintId } from './types';

export const START_POINTS = 100;
export const MAX_GUESSES = 8;

export const HINT_COST: Record<HintId, number> = {
  zone: 10, line: 20, suburb: 25, letter: 30, region: 40,
};

export function pointsLeft(hints: HintId[], hard = false): number {
  const spent = hints.reduce((t, h) => t + HINT_COST[h] * (hard ? 2 : 1), 0);
  return Math.max(0, START_POINTS - spent);
}

/** Final score: hint points left plus 10 per unused guess. 0 if not solved. */
export function score(solved: boolean, guesses: number, hints: HintId[], hard = false): number {
  if (!solved) return 0;
  return pointsLeft(hints, hard) + Math.max(0, maxGuesses(hard) - guesses) * 10;
}

/** Hard hides the lines a guess would ride, so it gets more guesses (user, 2026-11-19). */
export const HARD_MAX_GUESSES = 12;
export function maxGuesses(hard: boolean): number { return hard ? HARD_MAX_GUESSES : MAX_GUESSES; }
