import { describe, expect, it } from 'vitest';
import network from '../data/network.json';
import regionalData from '../data/regional.json';
import type { Network } from './types';
import { regionalTarget } from './regional';
import { hintText } from './hints';

const metro = network as Network;
const reg = (regionalData as unknown as { network: Network }).network;

describe('Regional mode', () => {
  it('the hidden station is always a country station, never one metro trains also stop at', () => {
    const metroIds = new Set(metro.stations.map((s) => s.id));
    for (let i = 0; i < 300; i++) {
      const t = regionalTarget(reg, metro, () => i / 300);
      expect(metroIds.has(t.id)).toBe(false);
    }
  });
  it('the Area hint has bands that mean something in the country', () => {
    const id = (n: string) => reg.stations.find((s) => s.name === n)!.id;
    expect(hintText(reg, id('Geelong'), 'region')).toMatch(/30–80 km$/);
    expect(hintText(reg, id('Ballarat'), 'region')).toMatch(/80–150 km$/);
    expect(hintText(reg, id('Albury'), 'region')).toMatch(/over 150 km$/);
  });
});
