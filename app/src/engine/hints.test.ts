import { describe, expect, it } from 'vitest';
import { fixture } from './fixture';
import network from '../data/network.json';
import type { Network } from './types';
import { hintText } from './hints';
import { dailyMode, useHint } from './modes/daily';
import { pointsLeft } from './score';

const net = network as Network;
const id = (name: string) => net.stations.find((s) => s.name === name)!.id;

describe('hintText', () => {
  it('names the rarest line through the target (most telling)', () => {
    expect(hintText(fixture, 'C', 'line')).toBe('One line through it: Blue'); // blue 3 stations, red 5
  });
  it('gives the first letter', () => {
    expect(hintText(fixture, 'E', 'letter')).toBe('Starts with "E"');
  });
  it('gives the fare zone, with the overlap spelled out', () => {
    expect(hintText(net, id('Frankston'), 'zone')).toBe('Zone 2');
    expect(hintText(net, id('Flinders Street'), 'zone')).toBe('Zone 1');
    const overlap = net.stations.find((s) => s.zone === '1/2')!;
    expect(hintText(net, overlap.id, 'zone')).toBe('Zone 1/2 (the overlap)');
  });
  it('names the council area, not the suburb (most stations share their suburb\'s name)', () => {
    expect(hintText(net, id('Aspendale'), 'suburb')).toBe('Council area: Kingston');
  });
  it('is unavailable when the data has no zone or council area', () => {
    expect(hintText(fixture, 'C', 'zone')).toBeNull();
    expect(hintText(fixture, 'C', 'suburb')).toBeNull();
  });
  it('gives direction and distance from the city', () => {
    expect(hintText(net, id('Flinders Street'), 'region')).toBe('In the city centre');
    expect(hintText(net, id('Frankston'), 'region')).toBe('South of the city, 30–80 km'); // bearing 158°
    expect(hintText(net, id('Pakenham'), 'region')).toBe('South-east of the city, 30–80 km'); // ~123°
    expect(hintText(net, id('Craigieburn'), 'region')).toBe('North of the city, 15–30 km');
  });
});

describe('useHint', () => {
  const start = () => dailyMode.init(fixture, { seed: 1, targetId: 'C' });
  it('spends points once per hint', () => {
    let s = useHint(fixture, start(), 'letter');
    s = useHint(fixture, s, 'letter');
    expect(s.hints).toEqual(['letter']);
    expect(pointsLeft(s.hints)).toBe(70);
  });
  it('refuses unavailable hints and hints after the game is over', () => {
    const real = dailyMode.init(net, { seed: 1, targetId: id('Frankston') });
    expect(useHint(net, real, 'suburb').hints).toEqual(['suburb']);
    const over = dailyMode.guess(fixture, start(), 'C');
    expect(useHint(fixture, over, 'zone').hints).toEqual([]);
    expect(useHint(fixture, start(), 'zone').hints).toEqual([]); // fixture has no zones
  });
});
