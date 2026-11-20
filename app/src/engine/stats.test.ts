import { describe, expect, it } from 'vitest';
import { emptyStats, recordResult, shownStreak, loadJSON, saveJSON } from './stats';

describe('recordResult', () => {
  it('counts a win, the guess distribution and starts a streak', () => {
    const s = recordResult(emptyStats(), 10, true, 3);
    expect(s).toMatchObject({ played: 1, wins: 1, current: 1, best: 1, lastGame: 10 });
    expect(s.dist[2]).toBe(1); // solved in 3
  });
  it('extends the streak on consecutive days and resets after a missed day', () => {
    let s = recordResult(emptyStats(), 10, true, 2);
    s = recordResult(s, 11, true, 4);
    expect(s.current).toBe(2);
    s = recordResult(s, 13, true, 1); // skipped game 12
    expect(s).toMatchObject({ current: 1, best: 2 });
  });
  it('a loss ends the streak', () => {
    let s = recordResult(emptyStats(), 10, true, 2);
    s = recordResult(s, 11, false, 8);
    expect(s).toMatchObject({ played: 2, wins: 1, current: 0, best: 1 });
  });
  it('recording the same game twice changes nothing', () => {
    const s = recordResult(emptyStats(), 10, true, 2);
    expect(recordResult(s, 10, true, 2)).toEqual(s);
  });
});

describe('shownStreak', () => {
  it('shows 0 once a day has been missed', () => {
    const s = recordResult(emptyStats(), 10, true, 2);
    expect(shownStreak(s, 10)).toBe(1);
    expect(shownStreak(s, 11)).toBe(1); // today not played yet
    expect(shownStreak(s, 12)).toBe(0);
  });
});

describe('storage', () => {
  it('survives storage that throws or holds junk', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(loadJSON(broken, 'k', 5)).toBe(5);
    expect(() => saveJSON(broken, 'k', 1)).not.toThrow();
    const junk = { getItem: () => '{not json', setItem: () => {} };
    expect(loadJSON(junk, 'k', 'fallback')).toBe('fallback');
  });
  it('round-trips a value', () => {
    const m = new Map<string, string>();
    const mem = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveJSON(mem, 'k', { a: [1, 2] });
    expect(loadJSON(mem, 'k', null)).toEqual({ a: [1, 2] });
  });
});
