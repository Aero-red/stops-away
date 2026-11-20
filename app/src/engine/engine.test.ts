import { describe, expect, it } from 'vitest';
import network from '../data/network.json';
import type { Network } from './types';

const PINNED_42 = 'DBAFGCE'; // recorded 2026-11-19; Hermes R1 checked 40 cycles with no repeats
import { fixture as net } from './fixture';
import { shortestRoute } from './route';
import { dayNumber, pickTarget } from './daily';
import { pointsLeft, score } from './score';
import { suggest } from './match';
import { dailyMode, practiceMode, solved } from './modes/daily';

describe('shortestRoute', () => {
  it('same station is zero stops', () => {
    expect(shortestRoute(net, 'C', 'C')).toEqual({ path: ['C'], stops: 0, changes: 0, lines: [] });
  });
  it('stays on one line when possible', () => {
    const r = shortestRoute(net, 'A', 'E')!;
    expect(r.path).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(r).toMatchObject({ stops: 4, changes: 0, lines: ['red'] });
  });
  it('counts a change', () => {
    const r = shortestRoute(net, 'B', 'F')!;
    expect(r).toMatchObject({ path: ['B', 'C', 'F'], stops: 2, changes: 1, lines: ['red', 'blue'] });
  });
  it('prefers fewer changes over fewer stops', () => {
    // B→G: via C/F is red+blue (3 stops, 1 change); via A is red+green (2 stops, 1 change)
    const r = shortestRoute(net, 'B', 'G')!;
    expect(r.changes).toBe(1);
    expect(r.stops).toBe(2);
    expect(r.path).toEqual(['B', 'A', 'G']);
  });
  it('unknown station is null', () => {
    expect(shortestRoute(net, 'A', 'Z')).toBeNull();
  });
  it('route is symmetric in stops and changes', () => {
    for (const a of net.stations) for (const b of net.stations) {
      const x = shortestRoute(net, a.id, b.id)!, y = shortestRoute(net, b.id, a.id)!;
      expect([x.stops, x.changes]).toEqual([y.stops, y.changes]);
    }
  });
});

describe('daily', () => {
  it('is deterministic: the same seed gives the same pinned sequence, another seed a different one', () => {
    const seq = (seed: number) => Array.from({ length: 7 }, (_, i) => pickTarget(i + 1, seed, net.stations).id).join('');
    expect(seq(42)).toBe(PINNED_42);
    expect(seq(43)).not.toBe(PINNED_42);
  });
  it('uses every station once per cycle', () => {
    const n = net.stations.length;
    for (const cycle of [0, 1, 3]) {
      const ids = Array.from({ length: n }, (_, i) => pickTarget(cycle * n + i + 1, 42, net.stations).id);
      expect(new Set(ids).size).toBe(n);
    }
  });
  it('day number follows Melbourne midnight', () => {
    // 2026-01-01 13:30 UTC = 2026-01-02 00:30 AEDT → game 2
    expect(dayNumber(new Date(Date.UTC(2026, 0, 1, 13, 30)))).toBe(2);
    expect(dayNumber(new Date(Date.UTC(2026, 0, 1, 12, 30)))).toBe(1);
  });
});

describe('score', () => {
  it('hints cost points, double on hard, floor 0', () => {
    expect(pointsLeft(['zone', 'line'])).toBe(70);
    expect(pointsLeft(['zone', 'line'], true)).toBe(40);
    expect(pointsLeft(['region', 'letter', 'suburb', 'line'])).toBe(0);
  });
  it('unsolved is 0; unused guesses add 10', () => {
    expect(score(false, 3, [])).toBe(0);
    expect(score(true, 3, ['zone'])).toBe(90 + 50);
  });
});

describe('suggest', () => {
  it('matches case, St/Street, alias and word prefix', () => {
    expect(suggest('alpha st', net.stations)[0].id).toBe('A');
    expect(suggest('ALS', net.stations)[0].id).toBe('A');
    expect(suggest('park', net.stations)[0].id).toBe('E');
    expect(suggest('', net.stations)).toEqual([]);
  });
});

describe('daily mode', () => {
  it('plays to a win and shares without names', () => {
    let s = dailyMode.init(net, { seed: 1, game: 3, targetId: 'F' });
    s = dailyMode.guess(net, s, 'A');
    s = dailyMode.guess(net, s, 'A'); // repeat ignored
    s = dailyMode.guess(net, s, 'C');
    s = dailyMode.guess(net, s, 'F');
    expect(s.guesses.map((g) => g.stationId)).toEqual(['A', 'C', 'F']);
    expect(solved(s)).toBe(true);
    expect(dailyMode.isOver(s)).toBe(true);
    expect(dailyMode.guess(net, s, 'B')).toBe(s); // no guesses after the end
    const card = dailyMode.share(s);
    expect(card).toMatch(/^Stops Away #3 3\/8 · \d+ pts\n⬜🟧🟩$/);
    expect(card).not.toMatch(/Foxtrot|Central|Alpha/);
  });
  it('ends after exactly 8 wrong guesses', () => {
    const real = network as Network;
    const target = real.stations[0].id;
    const wrong = real.stations.slice(1, 9).map((x) => x.id);
    let s = practiceMode.init(real, { seed: 1, targetId: target });
    for (const id of wrong.slice(0, 7)) s = practiceMode.guess(real, s, id);
    expect(practiceMode.isOver(s)).toBe(false); // 7 wrong: still playing
    s = practiceMode.guess(real, s, wrong[7]);
    expect(practiceMode.isOver(s)).toBe(true);  // 8th wrong: over
    expect(solved(s)).toBe(false);
  });
});

describe('gaps found by mutation check (2026-11-19)', () => {
  it('takes a longer one-line trip over a shorter trip with a change', () => {
    // P→T: red P-Q-R-S-T is 4 stops, 0 changes; blue P-M then green M-T is 2 stops, 1 change
    const s = (id: string, lines: string[]) => ({ id, name: id, aliases: [], lat: 0, lon: 0, zone: '1', suburb: '', lga: '', lines });
    const n = {
      stations: [s('P', ['red', 'blue']), s('Q', ['red']), s('R', ['red']), s('S', ['red']),
        s('T', ['red', 'green']), s('M', ['blue', 'green'])],
      lines: [{ id: 'red', name: 'Red', colour: '#d33' }, { id: 'blue', name: 'Blue', colour: '#36c' },
        { id: 'green', name: 'Green', colour: '#2a2' }],
      edges: [{ a: 'P', b: 'Q', line: 'red' }, { a: 'Q', b: 'R', line: 'red' }, { a: 'R', b: 'S', line: 'red' },
        { a: 'S', b: 'T', line: 'red' }, { a: 'P', b: 'M', line: 'blue' }, { a: 'M', b: 'T', line: 'green' }],
    };
    expect(shortestRoute(n, 'P', 'T')).toMatchObject({ path: ['P', 'Q', 'R', 'S', 'T'], stops: 4, changes: 0 });
  });
  it('shuffles each cycle differently, so the order is not predictable', () => {
    const n = net.stations.length;
    const cycle = (c: number) => Array.from({ length: n }, (_, i) => pickTarget(c * n + i + 1, 42, net.stations).id);
    expect(cycle(1)).not.toEqual(cycle(0));
  });
  it('ignores a typed "station"', () => {
    expect(suggest('central station', net.stations)[0]?.id).toBe('C');
  });
});
