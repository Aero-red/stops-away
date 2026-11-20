import { describe, expect, it } from 'vitest';
import { fixture as net } from './fixture';
import network from '../data/network.json';
import type { Network } from './types';
import { connectStart, connectMove, connectOver, connectShare, neighbours } from './connect';

// fixture: red A-B-C-D-E, blue C-F-G, green A-G
describe('Connect: from A to B one neighbouring station at a time', () => {
  it('neighbours are the stations one track away', () => {
    expect(neighbours(net, 'C').sort()).toEqual(['B', 'D', 'F']);
  });
  it('starts with a par equal to the shortest route in stops', () => {
    const s = connectStart(net, 'E', 'G');
    expect(s).toMatchObject({ from: 'E', to: 'G', par: 4, path: ['E'] }); // E-D-C-F-G
  });
  it('a move must be to a neighbour of where you are', () => {
    let s = connectStart(net, 'E', 'G');
    const bad = connectMove(net, s, 'A');
    expect(bad.ok).toBe(false);
    expect(bad.state).toBe(s);
    s = connectMove(net, s, 'D').state;
    expect(s.path).toEqual(['E', 'D']);
  });
  it('reaching the goal ends it; the card shows moves against par without names', () => {
    let s = connectStart(net, 'E', 'G');
    for (const id of ['D', 'C', 'B', 'A', 'G']) s = connectMove(net, s, id).state; // 5 moves, par 4
    expect(connectOver(s)).toBe(true);
    const card = connectShare(s);
    expect(card).toMatch(/^Stops Away Connect · ★★ · 5 moves \(par 4\)/);
    expect(card).not.toMatch(/Echo|Golf|Delta/);
  });
  it('runs out after par x 2 + 4 moves', () => {
    let s = connectStart(net, 'A', 'B'); // par 1 -> 6 moves allowed
    for (const id of ['G', 'A', 'G', 'A', 'G', 'A']) s = connectMove(net, s, id).state;
    expect(connectOver(s)).toBe(true);
    expect(connectMove(net, s, 'B').ok).toBe(false);
  });
  it('real network: a random pair is 5 to 10 stops apart', async () => {
    const { connectPair } = await import('./connect');
    const real = network as Network;
    for (let i = 0; i < 20; i++) {
      const [a, b] = connectPair(real, () => (i * 37 % 100) / 100, () => (i * 53 % 100) / 100);
      const par = connectStart(real, a, b).par;
      expect(par).toBeGreaterThanOrEqual(5);
      expect(par).toBeLessThanOrEqual(10);
    }
  });
});

import { connectDaily, connectHint, connectPair, stars } from './connect';
import { shortestRoute } from './route';

describe('Connect, deeper: pairs, daily, feedback, hints, stars', () => {
  const real = network as Network;
  it('pairs always need at least one change of line', () => {
    for (let i = 0; i < 25; i++) {
      const [a, b] = connectPair(real, () => (i * 41 % 100) / 100, () => (i * 67 % 100) / 100);
      expect(shortestRoute(real, a, b)!.changes).toBeGreaterThanOrEqual(1);
    }
  });
  it('the daily pair is the same for everyone on a day, and changes day to day', () => {
    expect(connectDaily(real, 400)).toEqual(connectDaily(real, 400));
    const days = new Set(Array.from({ length: 10 }, (_, i) => connectDaily(real, 400 + i).join('>')));
    expect(days.size).toBeGreaterThan(7);
  });
  it('each move says whether it brought you closer to the goal', () => {
    let s = connectStart(net, 'E', 'G');                // E is 4 from G
    let r = connectMove(net, s, 'D'); expect(r.trend).toBe('closer');  s = r.state; // 3
    r = connectMove(net, s, 'E'); expect(r.trend).toBe('further');     s = r.state; // back to 4
    r = connectMove(net, s, 'D'); s = r.state;
    r = connectMove(net, s, 'C'); s = r.state;          // C is 2 from G (via F or B-A)
    r = connectMove(net, s, 'B'); expect(r.trend).toBe('same');        // B-A-G is also 2
  });
  it('"Which way?" gives the next station on a shortest route and is counted', () => {
    const s = connectStart(net, 'E', 'G');
    const h = connectHint(net, s);
    expect(h.next).toBe('D');
    expect(h.state.hints).toBe(1);
  });
  it('stars: 3 at par, 2 within two of par, 1 for reaching it, minus one per hint, 0 if not reached', () => {
    const play = (moves: string[], hints = 0) => {
      let s = { ...connectStart(net, 'E', 'G'), hints };
      for (const m of moves) s = connectMove(net, s, m).state;
      return stars(s);
    };
    expect(play(['D', 'C', 'F', 'G'])).toBe(3);                 // par 4
    expect(play(['D', 'C', 'B', 'A', 'G'])).toBe(2);            // par + 1
    expect(play(['D', 'E', 'D', 'C', 'B', 'A', 'G'])).toBe(1);  // par + 3
    expect(play(['D', 'C', 'F', 'G'], 1)).toBe(2);              // a hint costs a star
    expect(play(['D', 'C', 'F', 'G'], 5)).toBe(1);              // reaching it is always worth one
    expect(play(['D'])).toBe(0);
  });
  it('the share card shows the stars', () => {
    let s = connectStart(net, 'E', 'G');
    for (const m of ['D', 'C', 'F', 'G']) s = connectMove(net, s, m).state;
    expect(connectShare(s).split('\n')[0]).toBe('Stops Away Connect · ★★★ · 4 moves (par 4)');
  });
});
