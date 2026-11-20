import { describe, expect, it } from 'vitest';
import type { Feedback } from '../engine/modes/types';
import { mapReveal } from './reveal';

const g = (id: string, lines: string[], correct = false): Feedback =>
  ({ stationId: id, correct, route: { path: [id, 'T'], stops: correct ? 0 : 5, changes: lines.length - 1, lines } });

describe('mapReveal: the map never shows more than the history text while the game is on', () => {
  it('mid-game: lights the lines of the latest guess and draws no route (a route ends at the answer)', () => {
    const r = mapReveal([g('A', ['red']), g('B', ['blue', 'green'])], false, null);
    expect([...r.litLines].sort()).toEqual(['blue', 'green']);
    expect(r.routes).toEqual([]);
    expect(r.focus).toBe('B');
  });
  it('a tapped earlier guess lights its own lines instead', () => {
    const r = mapReveal([g('A', ['red']), g('B', ['blue'])], false, 'A');
    expect([...r.litLines]).toEqual(['red']);
    expect(r.focus).toBe('A');
  });
  it('once the game is over every journey may be drawn', () => {
    const r = mapReveal([g('A', ['red']), g('T', [], true)], true, null);
    expect(r.routes.map((x) => x.stationId)).toEqual(['A']); // the winning guess has no journey to draw
  });
  it('nothing to light before the first guess', () => {
    const r = mapReveal([], false, null);
    expect(r.litLines.size).toBe(0);
    expect(r.focus).toBeNull();
  });
});

describe('mapReveal in Hard: lines are not told', () => {
  it('lights no lines mid-game when lines are hidden', () => {
    const r = mapReveal([g('A', ['red', 'blue'])], false, null, true);
    expect(r.litLines.size).toBe(0);
    expect(r.focus).toBe('A'); // the map still flies to the guess
  });
  it('after the game the journeys can still be drawn', () => {
    expect(mapReveal([g('A', ['red']), g('T', [], true)], true, null, true).routes).toHaveLength(1);
  });
});

describe('mapReveal at the end: only the journeys between your guesses and the answer', () => {
  it('lists the stations on those journeys, and lights no whole lines', () => {
    const a = { stationId: 'A', correct: false, route: { path: ['A', 'x', 'T'], stops: 2, changes: 0, lines: ['red'] } };
    const b = { stationId: 'B', correct: false, route: { path: ['B', 'y', 'T'], stops: 2, changes: 0, lines: ['blue'] } };
    const t = { stationId: 'T', correct: true, route: { path: ['T'], stops: 0, changes: 0, lines: [] } };
    const r = mapReveal([a, b, t], true, null);
    expect([...r.endStops].sort()).toEqual(['A', 'B', 'T', 'x', 'y']);
    expect(r.litLines.size).toBe(0);
  });
  it('is empty while the game is on', () => {
    expect(mapReveal([g('A', ['red'])], false, null).endStops.size).toBe(0);
  });
});
