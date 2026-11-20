import { describe, expect, it } from 'vitest';
import { fixture as net } from '../engine/fixture';
import { shortestRoute } from '../engine/route';
import { fixtureLayout as L, hopLines, neighbourInDirection } from './layout';

describe('hopLines', () => {
  it('colours each hop by the line it rides', () => {
    expect(hopLines(net, shortestRoute(net, 'B', 'F')!)).toEqual(['red', 'blue']);
    expect(hopLines(net, shortestRoute(net, 'B', 'G')!)).toEqual(['red', 'green']);
    expect(hopLines(net, shortestRoute(net, 'A', 'E')!)).toEqual(['red', 'red', 'red', 'red']);
  });
});

describe('neighbourInDirection', () => {
  it('follows tracks with arrow keys', () => {
    expect(neighbourInDirection(net, L, 'C', 'right')).toBe('D');
    expect(neighbourInDirection(net, L, 'C', 'left')).toBe('B');
    expect(neighbourInDirection(net, L, 'C', 'down')).toBe('F');
    expect(neighbourInDirection(net, L, 'C', 'up')).toBeNull();
  });
});

import { tickAngle } from './layout';

describe('tickAngle (degrees; a station tick points across its track)', () => {
  const L = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, c: { x: 2, y: 0 }, d: { x: 1, y: 1 }, e: { x: 2, y: 1 } };
  const E = (pairs: [string, string][]) => pairs.map(([a, b]) => ({ a, b, line: 'x' }));
  it('is vertical on a horizontal track', () => {
    expect(Math.abs(tickAngle('b', E([['a', 'b'], ['b', 'c']]), L))).toBeCloseTo(90);
  });
  it('is horizontal on a vertical track', () => {
    expect(Math.abs(tickAngle('b', E([['b', 'd']]), L)) % 180).toBeCloseTo(0);
  });
  it('bisects a 45 degree bend', () => {
    // in along +x, out along +x+y: the track turns 45 degrees, the tick sits across the average direction
    expect(tickAngle('b', E([['a', 'b'], ['b', 'e']]), { ...L, e: { x: 2, y: 1 } })).toBeCloseTo(90 + 22.5);
  });
});
