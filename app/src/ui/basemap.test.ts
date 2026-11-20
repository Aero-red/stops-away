import { describe, expect, it } from 'vitest';
import geo from '../data/geo.json';
import network from '../data/network.json';
import { cameraFor, unitToLngLat, type World } from './basemap';

const world = (geo as { world: World }).world;
const st = (name: string) => network.stations.find((s) => s.name === name)!;
const pos = (geo as { stations: Record<string, { x: number; y: number }> }).stations;

describe('basemap: our map units to MapLibre', () => {
  it('converts map units back to the station\'s real longitude and latitude', () => {
    for (const name of ['Flinders Street', 'Frankston', 'Sunbury']) {
      const s = st(name);
      const [lng, lat] = unitToLngLat(pos[s.id].x, pos[s.id].y, world);
      expect(lng).toBeCloseTo(s.lon, 5);
      expect(lat).toBeCloseTo(s.lat, 5);
    }
  });
  it('centres the camera on the middle of the view', () => {
    const fss = st('Flinders Street');
    const c = cameraFor({ x: -5, y: -5, w: 10, h: 10 }, { w: 800, h: 800 }, world);
    expect(c.center[0]).toBeCloseTo(fss.lon, 5);
    expect(c.center[1]).toBeCloseTo(fss.lat, 5);
  });
  it('picks the zoom where one map unit is k screen px (512 px tiles: 2^(z+1) px per world px)', () => {
    const c = cameraFor({ x: 0, y: 0, w: 10, h: 10 }, { w: 800, h: 800 }, world); // k = 80
    expect(c.zoom).toBeCloseTo(Math.log2(80 * world.scale) - 1, 9);
    const twice = cameraFor({ x: 0, y: 0, w: 5, h: 5 }, { w: 800, h: 800 }, world);
    expect(twice.zoom - c.zoom).toBeCloseTo(1, 9); // half the view = one zoom level in
  });
});
