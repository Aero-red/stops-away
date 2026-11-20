import type { HintId, Network } from '../types';
import type { Feedback, Mode } from './types';
import { pickTarget } from '../daily';
import { shortestRoute } from '../route';
import { HINT_COST, maxGuesses, pointsLeft, score } from '../score';
import { hintText } from '../hints';
import { warmth, WARMTH_SQUARE } from '../warmth';

export interface GuessState {
  mode: string;
  game: number;
  targetId: string;
  guesses: Feedback[];
  hints: HintId[];
  hard: boolean;
}

function makeGuessMode(id: string, label: string): Mode<GuessState> {
  return {
    id,
    init(net, { seed, game = 1, targetId }) {
      const target = targetId ?? pickTarget(game, seed, net.stations).id;
      return { mode: id, game, targetId: target, guesses: [], hints: [], hard: false };
    },
    guess(net, state, stationId) {
      if (this.isOver(state)) return state;
      if (state.guesses.some((g) => g.stationId === stationId)) return state; // no repeat guesses
      const f: Feedback = {
        stationId,
        correct: stationId === state.targetId,
        route: shortestRoute(net, stationId, state.targetId),
      };
      return { ...state, guesses: [...state.guesses, f] };
    },
    isOver(state) {
      return state.guesses.some((g) => g.correct) || state.guesses.length >= maxGuesses(state.hard);
    },
    feedback(state) {
      return state.guesses;
    },
    share(state) {
      const solved = state.guesses.some((g) => g.correct);
      const n = solved ? String(state.guesses.length) : 'X';
      const pts = score(solved, state.guesses.length, state.hints, state.hard);
      const head = id === 'daily' ? `${label} #${state.game}` : label;
      return `${head} ${n}/${maxGuesses(state.hard)} · ${pts} pts${state.hard ? ' · Hard' : ''}\n${warmth(state.guesses).map((w) => WARMTH_SQUARE[w]).join('')}`;
    },
  };
}

export const dailyMode = makeGuessMode('daily', 'Stops Away');
export const practiceMode = makeGuessMode('practice', 'Stops Away Practice');
export const duelMode = makeGuessMode('duel', 'Stops Away Duel');

export function solved(state: GuessState): boolean {
  return state.guesses.some((g) => g.correct);
}

export type { Network };

/** Buy a hint: once each, only while playing, only if the data can answer it. */
export function useHint(net: Network, state: GuessState, hint: HintId): GuessState {
  const over = state.guesses.some((g) => g.correct) || state.guesses.length >= maxGuesses(state.hard);
  if (over || state.hints.includes(hint) || hintText(net, state.targetId, hint) === null) return state;
  if (HINT_COST[hint] * (state.hard ? 2 : 1) > pointsLeft(state.hints, state.hard)) return state;
  return { ...state, hints: [...state.hints, hint] };
}

/** Hard mode (no names or lines told, 12 guesses, hints cost double) is chosen before play starts.
 *  Mid-game it can only be dropped to Easy (never raised, which would add guesses), while the
 *  game is still going and within Easy's guess limit. */
export function setHard(state: GuessState, on: boolean): GuessState {
  if (!state.guesses.length && !state.hints.length) return { ...state, hard: on };
  const over = state.guesses.some((g) => g.correct) || state.guesses.length >= maxGuesses(state.hard);
  if (!on && state.hard && !over && state.guesses.length < maxGuesses(false)) return { ...state, hard: false };
  return state;
}

/** True when a daily game from an earlier day should give way to today's: it is finished,
 *  or was never started. A game in progress at midnight is left to finish. */
export function rollover(state: GuessState, today: number): boolean {
  if (state.mode !== 'daily' || state.game >= today) return false;
  const over = state.guesses.some((g) => g.correct) || state.guesses.length >= maxGuesses(state.hard);
  const untouched = state.guesses.length === 0 && state.hints.length === 0;
  return over || untouched;
}
