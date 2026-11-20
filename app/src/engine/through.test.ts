import { describe, expect, it } from 'vitest';
import { fixture } from './fixture';
import network from '../data/network.json';
import type { Network } from './types';
import { shortestRoute } from './route';

const net = network as Network;
const id = (name: string) => net.stations.find((s) => s.name === name)!.id;

describe('through-running (one train, two line names)', () => {
  // fixture: red A-B-C-D-E, blue C-F-G. Pretend red and blue through-run at C.
  const thru: Network = { ...fixture, through: [{ a: 'red', b: 'blue', at: 'C' }] };
  it('switching between through-running lines at the joining station is not a change', () => {
    expect(shortestRoute(thru, 'B', 'F')).toMatchObject({ path: ['B', 'C', 'F'], changes: 0, lines: ['red', 'blue'] });
  });
  it('the same switch anywhere else, or without the pair, is still a change', () => {
    expect(shortestRoute(fixture, 'B', 'F')!.changes).toBe(1);
    const elsewhere: Network = { ...fixture, through: [{ a: 'red', b: 'blue', at: 'A' }] };
    expect(shortestRoute(elsewhere, 'B', 'F')!.changes).toBe(1);
  });
  it('Metro Tunnel: Sunbury to Pakenham and Cranbourne needs no change (review H3 note)', () => {
    expect(shortestRoute(net, id('Sunbury'), id('Pakenham'))!.changes).toBe(0);
    expect(shortestRoute(net, id('Parkville'), id('Anzac'))!.changes).toBe(0);
    expect(shortestRoute(net, id('Watergardens'), id('Cranbourne'))!.changes).toBe(0);
  });
});
