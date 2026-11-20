import { describe, expect, it } from 'vitest';
import { BADGES, earned } from './badges';

describe('Badges: earned from what just happened, never twice', () => {
  it('a first win, and a quick one', () => {
    expect(earned({ kind: 'solved', guesses: 2, streak: 1, met: 3 }, [])).toEqual(['first-win', 'two-guesses']);
    expect(earned({ kind: 'solved', guesses: 1, streak: 1, met: 1 }, [])).toContain('one-guess');
  });
  it('streaks of 3 and 7 days', () => {
    expect(earned({ kind: 'solved', guesses: 5, streak: 3, met: 10 }, ['first-win'])).toEqual(['streak-3']);
    expect(earned({ kind: 'solved', guesses: 5, streak: 7, met: 10 }, ['first-win', 'streak-3'])).toEqual(['streak-7']);
  });
  it('mode badges: a full Line Run, Connect at par, a duel won', () => {
    expect(earned({ kind: 'linerun', complete: true, met: 20 }, [])).toEqual(['line-clear']);
    expect(earned({ kind: 'linerun', complete: false, met: 20 }, [])).toEqual([]);
    expect(earned({ kind: 'connect', moves: 6, par: 6, met: 20 }, [])).toEqual(['par']);
    expect(earned({ kind: 'connect', moves: 7, par: 6, met: 20 }, [])).toEqual([]);
    expect(earned({ kind: 'duel', verdict: 'win', met: 20 }, [])).toEqual(['duel-win']);
  });
  it('collection milestones at 50 and 100 stations met', () => {
    expect(earned({ kind: 'duel', verdict: 'lose', met: 50 }, [])).toEqual(['met-50']);
    expect(earned({ kind: 'duel', verdict: 'lose', met: 120 }, ['met-50'])).toEqual(['met-100']);
  });
  it('never awards a badge you already have, and every badge has a name and a line of text', () => {
    expect(earned({ kind: 'solved', guesses: 1, streak: 7, met: 200 }, BADGES.map((b) => b.id))).toEqual([]);
    for (const b of BADGES) { expect(b.name.length).toBeGreaterThan(2); expect(b.text.length).toBeGreaterThan(5); }
  });
});
