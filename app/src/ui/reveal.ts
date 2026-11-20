import type { Feedback } from '../engine/modes/types';

/** What the map may show. hideLines (Hard): not even which lines a guess would ride. While the game is on, never more than the history text says: the
 *  lines a guess would ride, lit up whole, but no route (a route ends at the hidden station and
 *  would give it away). Once the game is over, every guess's journey may be drawn. */
export function mapReveal(guesses: Feedback[], over: boolean, focusId: string | null, hideLines = false):
  { litLines: Set<string>; routes: Feedback[]; focus: string | null; endStops: Set<string> } {
  const focused = guesses.find((g) => g.stationId === focusId) ?? guesses.at(-1) ?? null;
  return {
    // mid-game: the lines the focused guess names (Hard: none). At the end no whole lines are lit:
    // only the journeys between the guesses and the answer are shown (user, 2026-11-19)
    litLines: new Set(over || hideLines ? [] : focused?.route?.lines ?? []),
    routes: over ? guesses.filter((g) => g.route && g.route.stops > 0) : [],
    focus: focused?.stationId ?? null,
    endStops: new Set(over ? guesses.flatMap((g) => g.route?.path ?? [g.stationId]) : []),
  };
}
