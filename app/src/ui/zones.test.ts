import { describe, expect, it } from 'vitest';
import network from '../data/network.json';
import geo from '../data/geo.json';
import schematic from '../data/schematic.json';
import type { Network } from '../engine/types';
import { inside, zoneBoundary } from './zones';

const net = network as Network;
const layouts = {
  map: (geo as { stations: Record<string, { x: number; y: number }> }).stations,
  diagram: (schematic as unknown as { stations: Record<string, { x: number; y: number }> }).stations,
};

describe('zoneBoundary: the Zone 1 / Zone 2 line, from each station\'s fare zone', () => {
  for (const [name, layout] of Object.entries(layouts)) {
    it(`${name}: every Zone 1 station is inside and every Zone 2 station outside`, () => {
      const poly = zoneBoundary(net, layout);
      expect(poly.length).toBeGreaterThan(10);
      const wrong = net.stations.filter((s) => (s.zone === '1' && !inside(layout[s.id], poly)) || (s.zone === '2' && inside(layout[s.id], poly)));
      expect(wrong.map((s) => `${s.name} (zone ${s.zone})`)).toEqual([]);
    });
  }
});
