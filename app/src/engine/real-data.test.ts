import { describe, expect, it } from 'vitest';
import type { Network } from './types';
import network from '../data/network.json';
import { shortestRoute } from './route';
import { suggest } from './match';

// Built by tools/build_data.py from the official GTFS (C1).
const net = network as Network;
const id = (name: string) => net.stations.find((s) => s.name === name)!.id;

describe('real Melbourne network', () => {
  it('every station is reachable from Flinders Street', () => {
    const unreachable = net.stations.filter((s) => !shortestRoute(net, id('Flinders Street'), s.id));
    expect(unreachable.map((s) => s.name)).toEqual([]);
  });
  it('Flinders Street to Frankston is one line, no change', () => {
    expect(shortestRoute(net, id('Flinders Street'), id('Frankston'))).toMatchObject({ changes: 0, lines: ['FKN'] });
  });
  it('Jordanville to Ringwood needs one change', () => {
    expect(shortestRoute(net, id('Jordanville'), id('Ringwood'))!.changes).toBe(1);
  });
  it('typing a station code finds it', () => {
    expect(suggest('FSS', net.stations)[0].name).toBe('Flinders Street');
  });
});
