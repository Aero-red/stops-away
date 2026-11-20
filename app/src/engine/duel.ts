import type { Network } from './types';
import type { GuessState } from './modes/daily';
import { START_POINTS, maxGuesses, pointsLeft } from './score';

// The station is sent as its place in the id-sorted list, scrambled with an invertible step
// (multiply and shift modulo a prime) so the link doesn't read as the answer. Not secret, just
// not a spoiler at a glance.
const P = 100003, A = 7919, B = 4242;

function inverse(a: number, m: number): number {
  let [t, nt, r, nr] = [0, 1, m, a % m];
  while (nr) { const q = Math.floor(r / nr); [t, nt] = [nt, t - q * nt]; [r, nr] = [nr, r - q * nr]; }
  return ((t % m) + m) % m;
}
const A_INV = inverse(A, P);
const ids = (net: Network) => net.stations.map((s) => s.id).sort();

/** One player's duel: guesses to solve (null = missed), hint points spent, and Easy or Hard.
 *  The friend plays the same mode, so both scores are on the same scale. */
export interface DuelResult { guesses: number | null; spent: number; hard: boolean }

export function duelResult(state: GuessState): DuelResult {
  const solved = state.guesses.some((g) => g.correct);
  return {
    guesses: solved ? state.guesses.length : null,
    spent: START_POINTS - pointsLeft(state.hints, state.hard),
    hard: state.hard,
  };
}

/** The game's own score: hint points left plus 10 per unused guess; 0 for a miss. */
export function duelPoints(r: DuelResult): number {
  if (r.guesses === null) return 0;
  return START_POINTS - r.spent + Math.max(0, maxGuesses(r.hard) - r.guesses) * 10;
}

/** A link code: the scrambled station, guesses ("x" = missed), hint points spent, "h" for Hard. */
export function duelEncode(net: Network, targetId: string, r: DuelResult): string {
  const i = ids(net).indexOf(targetId);
  return `${((i * A + B) % P).toString(36)}-${r.guesses ?? 'x'}-${r.spent}${r.hard ? 'h' : ''}`;
}

/** The station part of a code: the same for every result on that station (a storage key). */
export function duelStation(code: string): string { return code.split('-')[0]; }

export function duelDecode(net: Network, code: string): { targetId: string; result: DuelResult } | null {
  // the first links were "station-guesses": Easy, no hints counted
  const m = /^([a-z0-9]+)-([0-9]+|x)(?:-([0-9]+)(h?))?$/.exec(code ?? '');
  if (!m) return null;
  const enc = parseInt(m[1], 36);
  if (!Number.isFinite(enc) || enc >= P) return null;
  const i = (((enc - B) % P + P) % P) * A_INV % P;
  const all = ids(net);
  if (i >= all.length) return null;
  const hard = m[4] === 'h';
  const guesses = m[2] === 'x' ? null : Number(m[2]);
  if (guesses !== null && (guesses < 1 || guesses > maxGuesses(hard))) return null;
  const spent = Number(m[3] ?? 0);
  if (spent > START_POINTS || spent % 5 !== 0) return null; // every hint costs a multiple of 5
  return { targetId: all[i], result: { guesses, spent, hard } };
}

/** More points wins; any solve beats a miss; two misses draw. */
export function duelVerdict(mine: DuelResult, theirs: DuelResult): 'win' | 'lose' | 'draw' {
  if (mine.guesses === null || theirs.guesses === null) {
    if (mine.guesses === theirs.guesses) return 'draw';
    return mine.guesses === null ? 'lose' : 'win';
  }
  const a = duelPoints(mine), b = duelPoints(theirs);
  return a === b ? 'draw' : a > b ? 'win' : 'lose';
}

const modeText = (hard: boolean) => `${hard ? 'Hard' : 'Easy'} (${maxGuesses(hard)} guesses)`;
const tries = (n: number) => `${n} ${n === 1 ? 'guess' : 'guesses'}`;

/** What the friend reads before playing a challenge. */
export function duelIntro(theirs: DuelResult): string {
  if (theirs.guesses === null) return `A friend missed this one. Find it in ${modeText(theirs.hard)} to win.`;
  const hints = theirs.spent ? `${theirs.spent} hint points` : 'no hints';
  return `A friend found this station in ${tries(theirs.guesses)}, ${hints}: ${duelPoints(theirs)} pts. Beat it in ${modeText(theirs.hard)}.`;
}

/** The text sent with a link: a fresh challenge (theirs = null), or a reply that says who won. */
export function duelMessage(mine: DuelResult, theirs: DuelResult | null, url: string): string {
  const mode = mine.hard ? 'Hard' : 'Easy';
  if (!theirs) {
    return mine.guesses === null
      ? `I couldn't find this Stops Away station (${mode}). Can you? ${url}`
      : `I found this Stops Away station in ${tries(mine.guesses)}: ${duelPoints(mine)} pts (${mode}). Can you beat it? ${url}`;
  }
  const v = duelVerdict(mine, theirs);
  const end = v === 'win' ? 'I win!' : v === 'lose' ? 'You win!' : 'A draw!';
  const me = mine.guesses === null ? 'I missed it' : `I scored ${duelPoints(mine)} pts`;
  const you = theirs.guesses === null ? 'you missed it' : mine.guesses === null ? `you scored ${duelPoints(theirs)}` : `to your ${duelPoints(theirs)}`;
  const body = mine.guesses === null && theirs.guesses === null ? 'we both missed it' : mine.guesses !== null && theirs.guesses !== null ? `${me} ${you}` : `${me}, ${you}`;
  return `Stops Away duel: ${body}. ${end} ${url}`;
}
