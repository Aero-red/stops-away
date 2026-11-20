import { describe, expect, it } from 'vitest';
import type { Feedback } from './modes/types';
import { warmth, WARMTH_SQUARE } from './warmth';

const f = (stops: number | null, correct = false): Feedback =>
  ({ stationId: String(stops), correct, route: stops === null ? null : { path: [], stops, changes: 0, lines: [] } });

describe('warmth: each guess against your best so far (user decision 2026-11-19)', () => {
  it('the first guess is neutral, a new best is warmer, worse is colder, equal is same', () => {
    expect(warmth([f(30), f(22), f(25), f(22), f(9)])).toEqual(['first', 'warmer', 'colder', 'same', 'warmer']);
  });
  it('the target is a hit, whatever came before', () => {
    expect(warmth([f(5), f(0, true)])).toEqual(['first', 'hit']);
    expect(warmth([f(0, true)])).toEqual(['hit']);
  });
  it('compares with the best, not the previous guess', () => {
    expect(warmth([f(10), f(40), f(20)])).toEqual(['first', 'colder', 'colder']);
  });
  it('a guess with no route is colder', () => {
    expect(warmth([f(10), f(null)])).toEqual(['first', 'colder']);
  });
  it('share squares say it without colour names', () => {
    expect(warmth([f(30), f(22), f(25), f(0, true)]).map((w) => WARMTH_SQUARE[w]).join('')).toBe('⬜🟧🟦🟩');
  });
});
