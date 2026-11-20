import { describe, expect, it } from 'vitest';
import { fixture as net } from './fixture';
import { lineStations, runStart, runGuess, runOver, runShare, runSeconds, runLeft, runMissed, runGiveUp } from './linerun';
import network from '../data/network.json';
import type { Network } from './types';

describe('Line Run: name every station on a line against the clock', () => {
  it('lists the stations on a line', () => {
    expect(lineStations(net, 'blue').sort()).toEqual(['C', 'F', 'G']);
  });
  it('a station on the line is found once; one off the line is a miss', () => {
    let s = runStart(net, 'blue', 0);
    let r = runGuess(net, s, 'F', 1000);
    expect(r.result).toBe('found'); s = r.state;
    r = runGuess(net, s, 'F', 2000);
    expect(r.result).toBe('again'); s = r.state;
    r = runGuess(net, s, 'A', 3000);
    expect(r.result).toBe('miss'); s = r.state;
    expect(s.found).toEqual(['F']);
    expect(s.misses).toBe(1);
  });
  it('ends when every station is named, or when time runs out', () => {
    let s = runStart(net, 'blue', 0);
    for (const id of ['C', 'F', 'G']) s = runGuess(net, s, id, 5000).state;
    expect(runOver(s, 5000)).toBe(true);
    expect(s.doneAt).toBe(5000);
    const t = runStart(net, 'red', 0);
    expect(runOver(t, t.seconds * 1000 - 1)).toBe(false);
    expect(runOver(t, t.seconds * 1000)).toBe(true);
    expect(runGuess(net, t, 'A', t.seconds * 1000 + 5).result).toBe('over');
  });
  it('shares the count, the line and the time, but no station names', () => {
    let s = runStart(net, 'blue', 0);
    for (const id of ['C', 'F', 'G']) s = runGuess(net, s, id, 40_000).state;
    expect(runShare(net, s, 40_000)).toBe('Stops Away Line Run · Blue line · 3/3 · 0:40');
  });
});

describe('Line Run: the clock fits the line', () => {
  const real = network as Network;
  it('gives 20 s plus 8 s a station, rounded to 5 s', () => {
    expect(runSeconds(10)).toBe(100);   // Stony Point
    expect(runSeconds(14)).toBe(130);   // Sandringham: 132 -> 130
    expect(runSeconds(32)).toBe(275);   // Frankston: 276 -> 275
  });
  it('a longer line always gets at least as long', () => {
    for (let n = 1; n < 40; n++) expect(runSeconds(n + 1)).toBeGreaterThanOrEqual(runSeconds(n));
  });
  it('each run carries its own time, from its line', () => {
    expect(runStart(real, 'STY', 0).seconds).toBe(runSeconds(lineStations(real, 'STY').length));
    expect(runStart(real, 'FKN', 0).seconds).toBeGreaterThan(runStart(real, 'STY', 0).seconds);
  });
  it('time left counts down and stops at zero, and stops when the run is done', () => {
    const s = runStart(net, 'blue', 0);
    expect(runLeft(s, 0)).toBe(s.seconds * 1000);
    expect(runLeft(s, 10_000)).toBe(s.seconds * 1000 - 10_000);
    expect(runLeft(s, 10 ** 9)).toBe(0);
    let d = s; for (const id of ['C', 'F', 'G']) d = runGuess(net, d, id, 5000).state;
    expect(runLeft(d, 60_000)).toBe(s.seconds * 1000 - 5000);
  });
  it('giving up ends the run; missed stations are the ones not found', () => {
    let s = runStart(net, 'blue', 0);
    s = runGuess(net, s, 'F', 1000).state;
    expect(runMissed(net, s).sort()).toEqual(['C', 'G']);
    s = runGiveUp(s, 2000);
    expect(runOver(s, 2000)).toBe(true);
    expect(runGuess(net, s, 'C', 2500).result).toBe('over');
    expect(runShare(net, s, 9000)).toBe('Stops Away Line Run · Blue line · 1/3 · 0:02');
  });
});
