import { describe, expect, it } from 'vitest';
import network from '../data/network.json';
import type { Network } from './types';
import { duelEncode, duelDecode, duelVerdict, duelPoints, duelResult, duelStation, duelIntro, duelMessage, type DuelResult } from './duel';
import { practiceMode } from './modes/daily';

const net = network as Network;
const r = (guesses: number | null, spent = 0, hard = false): DuelResult => ({ guesses, spent, hard });

describe('Duel links: same hidden station for a friend, no server', () => {
  it('round-trips every station and every kind of result', () => {
    for (const s of net.stations) {
      for (const res of [r(1), r(5, 30), r(8, 0, true), r(null), r(null, 20, true), r(12, 100, true)]) {
        const code = duelEncode(net, s.id, res);
        expect(duelDecode(net, code)).toEqual({ targetId: s.id, result: res });
      }
    }
  });
  it('still reads the first links (station-guesses, Easy, no hints)', () => {
    const old = duelEncode(net, net.stations[3].id, r(4)).replace(/-0$/, '');
    expect(duelDecode(net, old)).toEqual({ targetId: net.stations[3].id, result: r(4) });
  });
  it('the code does not give the station away', () => {
    const s = net.stations.find((x) => x.name === 'Frankston')!;
    const code = duelEncode(net, s.id, r(3, 20, true));
    expect(code).not.toMatch(/frankston|FKN|vic:rail/i);
    expect(duelStation(code)).toBe(duelStation(duelEncode(net, s.id, r(null))));
  });
  it('rejects junk and impossible results', () => {
    expect(duelDecode(net, 'zzzzzz-3')).toBeNull();
    expect(duelDecode(net, 'hello')).toBeNull();
    expect(duelDecode(net, '')).toBeNull();
    const st = net.stations[0].id;
    const good = duelEncode(net, st, r(4)).split('-')[0];
    expect(duelDecode(net, `${good}-9-0`)).toBeNull(); // Easy has 8 guesses
    expect(duelDecode(net, `${good}-9-0h`)).not.toBeNull(); // Hard has 12
    expect(duelDecode(net, `${good}-13-0h`)).toBeNull();
    expect(duelDecode(net, `${good}-3-150`)).toBeNull(); // only 100 hint points to spend
  });
});

describe('Duel results are the game score: guesses and hints both count', () => {
  it('reads a finished game', () => {
    let g = practiceMode.init(net, { seed: 1, targetId: net.stations[0].id });
    g = { ...g, hints: ['zone', 'line'] };
    g = practiceMode.guess(net, g, net.stations[1].id);
    g = practiceMode.guess(net, g, net.stations[0].id);
    expect(duelResult(g)).toEqual(r(2, 30));
    expect(duelResult({ ...g, hard: true })).toEqual(r(2, 60, true));
  });
  it('points: hint points left plus 10 per unused guess; 0 for a miss', () => {
    expect(duelPoints(r(3))).toBe(150);
    expect(duelPoints(r(2, 40))).toBe(120);
    expect(duelPoints(r(null))).toBe(0);
  });
  it('more points wins, so hints are not free', () => {
    expect(duelVerdict(r(3), r(2, 40))).toBe('win'); // 150 vs 120
    expect(duelVerdict(r(2, 40), r(3))).toBe('lose');
    expect(duelVerdict(r(4), r(4))).toBe('draw');
  });
  it('any solve beats a miss, even one worth 0 points', () => {
    expect(duelVerdict(r(8, 100), r(null))).toBe('win');
    expect(duelVerdict(r(null), r(6))).toBe('lose');
    expect(duelVerdict(r(null), r(null, 30))).toBe('draw');
  });
});

describe('Duel words: what the friend is told, and what each link says', () => {
  it('the intro names the score to beat and the mode', () => {
    expect(duelIntro(r(4))).toBe('A friend found this station in 4 guesses, no hints: 140 pts. Beat it in Easy (8 guesses).');
    expect(duelIntro(r(1, 20, true))).toBe('A friend found this station in 1 guess, 20 hint points: 190 pts. Beat it in Hard (12 guesses).');
    expect(duelIntro(r(null))).toBe('A friend missed this one. Find it in Easy (8 guesses) to win.');
  });
  it('a challenge says what to beat; a reply says who won', () => {
    const url = 'https://x/#duel=abc-4-0';
    expect(duelMessage(r(4), null, url)).toBe(`I found this Stops Away station in 4 guesses: 140 pts (Easy). Can you beat it? ${url}`);
    expect(duelMessage(r(null, 0, true), null, url)).toBe(`I couldn't find this Stops Away station (Hard). Can you? ${url}`);
    expect(duelMessage(r(2), r(4), url)).toBe(`Stops Away duel: I scored 160 pts to your 140. I win! ${url}`);
    expect(duelMessage(r(null), r(4), url)).toBe(`Stops Away duel: I missed it, you scored 140. You win! ${url}`);
    expect(duelMessage(r(4), r(4), url)).toBe(`Stops Away duel: I scored 140 pts to your 140. A draw! ${url}`);
  });
});
