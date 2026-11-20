import { describe, expect, it } from 'vitest';
import { lineRuns, roundedPath } from './ribbon';

describe('lineRuns: a line as continuous station runs', () => {
  const e = (pairs: [string, string][], line = 'x') => pairs.map(([a, b]) => ({ a, b, line }));
  it('a simple line is one run, end to end', () => {
    const runs = lineRuns(e([['B', 'C'], ['A', 'B'], ['C', 'D']]), 'x');
    expect(runs).toHaveLength(1);
    expect(runs[0][0] === 'A' ? runs[0] : [...runs[0]].reverse()).toEqual(['A', 'B', 'C', 'D']);
  });
  it('a branching line splits at the junction, each edge drawn once', () => {
    const runs = lineRuns(e([['A', 'J'], ['J', 'B'], ['J', 'C']]), 'x');
    const edges = runs.flatMap((r) => r.slice(1).map((b, i) => [r[i], b].sort().join('')));
    expect(edges.sort()).toEqual(['AJ', 'BJ', 'CJ']);
  });
  it('a loop (City Loop) is drawn once and closes on itself', () => {
    const runs = lineRuns(e([['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']]), 'x');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(5);
    expect(runs[0][0]).toBe(runs[0][4]);
  });
  it('ignores other lines', () => {
    expect(lineRuns([...e([['A', 'B']]), ...e([['B', 'C']], 'y')], 'x')).toHaveLength(1);
  });
});

describe('roundedPath: corners become curves', () => {
  it('a straight run stays straight', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 3)).toBe('M0 0L20 0');
  });
  it('a corner is cut back by the radius and joined with a curve through the corner', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 3)).toBe('M0 0L7 0Q10 0 10 3L10 10');
  });
  it('never cuts back more than half a short segment', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], 5)).toBe('M0 0L1 0Q2 0 2 1L2 2');
  });
});

import { offsetPolyline } from './ribbon';

describe('offsetPolyline: a line shifted sideways into its lane', () => {
  it('shifts a straight run by its offset (positive = left of travel, screen axes)', () => {
    expect(offsetPolyline([{ p: { x: 0, y: 0 }, q: { x: 10, y: 0 }, o: 2 }])).toEqual([{ x: 0, y: 2 }, { x: 10, y: 2 }]);
  });
  it('meets at the mitre point on a corner', () => {
    const got = offsetPolyline([
      { p: { x: 0, y: 0 }, q: { x: 10, y: 0 }, o: 1 },
      { p: { x: 10, y: 0 }, q: { x: 10, y: 10 }, o: 1 },
    ]);
    expect(got.map((v) => [+v.x.toFixed(6), +v.y.toFixed(6)])).toEqual([[0, 1], [9, 1], [9, 10]]);
  });
});

describe('offsetPolyline mitre limit', () => {
  it('never sends a joint far away when segments are nearly parallel or reverse', () => {
    const cases = [
      [{ p: { x: 0, y: 0 }, q: { x: 10, y: 0 }, o: 1 }, { p: { x: 10, y: 0 }, q: { x: 20, y: 0.05 }, o: 3 }],  // nearly parallel, lane change
      [{ p: { x: 0, y: 0 }, q: { x: 10, y: 0 }, o: 1 }, { p: { x: 10, y: 0 }, q: { x: 0, y: 0.01 }, o: 1 }],    // doubles back
    ];
    for (const segs of cases) {
      const far = offsetPolyline(segs).slice(1, -1).some((v) => Math.hypot(v.x - 10, v.y) > 6); // joints only
      expect(far).toBe(false);
    }
  });
});
