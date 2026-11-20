import { describe, expect, it } from 'vitest';
import { fixture as net } from './fixture';
import { dailyMode, setHard, useHint } from './modes/daily';
import { pointsLeft } from './score';

const start = () => dailyMode.init(net, { seed: 1, game: 5, targetId: 'C' });

describe('hard mode', () => {
  it('can be switched only before the first guess or hint', () => {
    expect(setHard(start(), true).hard).toBe(true);
    const guessed = dailyMode.guess(net, start(), 'A');
    expect(setHard(guessed, true).hard).toBe(false);
    const hinted = useHint(net, start(), 'letter');
    expect(setHard(hinted, true).hard).toBe(false);
  });
  it('doubles hint costs and refuses a hint you cannot afford', () => {
    const zoned = { ...net, stations: net.stations.map((x) => ({ ...x, zone: '1' })) };
    let s = setHard(dailyMode.init(zoned, { seed: 1, game: 5, targetId: 'C' }), true);
    s = useHint(zoned, s, 'zone');   // 20
    s = useHint(zoned, s, 'line');   // 40
    s = useHint(zoned, s, 'letter'); // 60 > 40 left: refused (affordable in normal mode)
    expect(s.hints).toEqual(['zone', 'line']);
    expect(pointsLeft(s.hints, true)).toBe(40);
  });
  it('marks the share card', () => {
    const s = dailyMode.guess(net, setHard(start(), true), 'C');
    expect(dailyMode.share(s).split('\n')[0]).toBe('Stops Away #5 1/12 · 210 pts · Hard');
  });
});

import network from '../data/network.json';
import type { Network } from './types';
import { maxGuesses, HARD_MAX_GUESSES } from './score';
import { practiceMode } from './modes/daily';

describe('hard mode: more chances (user, 2026-11-19)', () => {
  const real = network as Network;
  const target = real.stations[0].id;
  const wrong = real.stations.slice(1, 13).map((s) => s.id);
  it('allows 12 guesses instead of 8', () => {
    expect(HARD_MAX_GUESSES).toBe(12);
    expect(maxGuesses(false)).toBe(8);
    expect(maxGuesses(true)).toBe(12);
    let s = setHard(practiceMode.init(real, { seed: 1, targetId: target }), true);
    for (const id of wrong.slice(0, 11)) s = practiceMode.guess(real, s, id);
    expect(practiceMode.isOver(s)).toBe(false); // 11 wrong: still playing in Hard (over at 8 in normal)
    s = practiceMode.guess(real, s, wrong[11]);
    expect(practiceMode.isOver(s)).toBe(true);
  });
  it('scores unused guesses against the Hard limit and shows it on the card', () => {
    let s = setHard(dailyMode.init(net, { seed: 1, game: 5, targetId: 'C' }), true);
    s = dailyMode.guess(net, s, 'C');
    expect(dailyMode.share(s).split('\n')[0]).toBe('Stops Away #5 1/12 · 210 pts · Hard'); // 100 + 11 x 10
  });
});

describe('switching Hard off mid-game', () => {
  const hardStart = () => setHard(dailyMode.init(net, { seed: 1, game: 5, targetId: 'C' }), true);
  it('Hard can be dropped to Easy after guessing, while within the Easy limit', () => {
    let s = hardStart();
    s = dailyMode.guess(net, s, 'A');
    expect(setHard(s, false).hard).toBe(false);
  });
  it('but not once more guesses are used than Easy allows, or once the game is over', () => {
    let s = hardStart();
    for (const id of ['A', 'B', 'D', 'E', 'F', 'G', 'A', 'B']) s = { ...s, guesses: [...s.guesses, { ...dailyMode.guess(net, s, id).guesses.at(-1)! }] };
    expect(s.guesses.length).toBe(8);
    expect(setHard(s, false).hard).toBe(true);           // 8 used: Easy would end the game on the spot
    const won = dailyMode.guess(net, hardStart(), 'C');
    expect(setHard(won, false).hard).toBe(true);         // finished games keep their mode
  });
  it('Easy still cannot become Hard after the first guess (that would add guesses)', () => {
    const s = dailyMode.guess(net, dailyMode.init(net, { seed: 1, game: 5, targetId: 'C' }), 'A');
    expect(setHard(s, true).hard).toBe(false);
  });
});
