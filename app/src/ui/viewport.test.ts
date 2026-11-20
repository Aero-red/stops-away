import { describe, expect, it } from 'vitest';
import { edgeSlots, fit, pan, zoomAt } from './viewport';

describe('fit', () => {
  it('contains the bounds with padding at the screen aspect', () => {
    const v = fit({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 2, 1);
    expect(v.h).toBeCloseTo(12);      // 10 tall + 1 padding each side
    expect(v.w).toBeCloseTo(24);      // widened to aspect 2
    expect(v.x + v.w / 2).toBeCloseTo(5); // centred
    expect(v.y + v.h / 2).toBeCloseTo(5);
  });
});

describe('zoomAt', () => {
  const v = { x: 0, y: 0, w: 10, h: 10 };
  it('zooms in keeping the pointed-at spot still', () => {
    const z = zoomAt(v, 2, 8, 2, { minW: 1, maxW: 100 });
    expect(z.w).toBeCloseTo(5);
    // (8,2) was at 80%/20% of the view and still is
    expect((8 - z.x) / z.w).toBeCloseTo(0.8);
    expect((2 - z.y) / z.h).toBeCloseTo(0.2);
  });
  it('stops at the zoom limits', () => {
    expect(zoomAt(v, 100, 5, 5, { minW: 2, maxW: 20 }).w).toBeCloseTo(2);
    expect(zoomAt(v, 0.01, 5, 5, { minW: 2, maxW: 20 }).w).toBeCloseTo(20);
  });
});

describe('pan', () => {
  it('moves the view by user units', () => {
    expect(pan({ x: 1, y: 1, w: 4, h: 4 }, 2, -1)).toEqual({ x: 3, y: 0, w: 4, h: 4 });
  });
});

describe('edgeSlots', () => {
  it('spreads lines that share a track side by side, centred', () => {
    const s = edgeSlots([
      { a: 'A', b: 'B', line: 'x' }, { a: 'A', b: 'B', line: 'y' }, { a: 'B', b: 'A', line: 'z' },
      { a: 'B', b: 'C', line: 'x' },
    ]);
    expect(s).toEqual([{ slot: -1, n: 3 }, { slot: 0, n: 3 }, { slot: 1, n: 3 }, { slot: 0, n: 1 }]);
  });
});

import { labelTier, slotSpacing } from './viewport';

describe('labelTier', () => {
  it('names only the hub when zoomed out, interchanges in the middle, all when close', () => {
    expect(labelTier(15, 1, true)).toBe(false);
    expect(labelTier(15, 9, true)).toBe(false);
    expect(labelTier(15, 9, true, true)).toBe(true);  // the hub (Flinders Street) always
    expect(labelTier(60, 4, true)).toBe(true);
    expect(labelTier(60, 2, true)).toBe(false);
    expect(labelTier(100, 1, true)).toBe(true);
    expect(labelTier(100, 9, false)).toBe(false);     // labels off (Normal/Hard)
  });
});

describe('slotSpacing', () => {
  it('keeps a shared-track band no wider than four tracks', () => {
    expect(slotSpacing(2, 4)).toBe(4);
    expect(slotSpacing(11, 4) * 11).toBeCloseTo(16);
  });
});

import { placeLabels, resolveTap } from './viewport';

describe('placeLabels (anchor = the stop on screen; tries right, left, above, below)', () => {
  const at = (id: string, x: number, y: number, priority: number, must = false) => ({ id, x, y, w: 60, h: 14, priority, must });
  it('puts a lone name to the right', () => {
    expect(placeLabels([at('a', 100, 100, 1)])).toEqual(new Map([['a', 'right']]));
  });
  it('moves a name to a free side instead of overlapping', () => {
    // b sits just right of a: a's right-hand label would cover b's, so the lower-priority one moves
    const got = placeLabels([at('a', 100, 100, 5), at('b', 140, 100, 1)]);
    expect(got.get('a')).toBe('right');
    expect(got.get('b')).not.toBe('right');
  });
  it('two must-show names in one spot both show, on different sides', () => {
    const got = placeLabels([at('g1', 100, 100, 0, true), at('g2', 102, 100, 0, true)]);
    expect(got.size).toBe(2);
    expect(got.get('g1')).not.toBe(got.get('g2'));
  });
  it('drops an optional name with no free side', () => {
    const ring = [at('m', 100, 100, 9, true), at('n', 100, 100, 9, true), at('o', 100, 100, 9, true), at('p', 100, 100, 9, true)];
    expect(placeLabels([...ring, at('x', 100, 100, 1)]).has('x')).toBe(false);
  });
});

describe('resolveTap (screen px)', () => {
  const pts = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 100, y: 0 }, { id: 'C', x: 106, y: 0 }];
  it('selects the only stop within reach', () => {
    expect(resolveTap(pts, { x: 10, y: 8 }, 22)).toEqual({ kind: 'select', id: 'A' });
  });
  it('selects the clearly nearest of several', () => {
    expect(resolveTap(pts, { x: 99, y: 0 }, 22)).toEqual({ kind: 'select', id: 'B' });
  });
  it('zooms in when two stops are about equally near', () => {
    expect(resolveTap(pts, { x: 103, y: 0 }, 22)).toEqual({ kind: 'zoom', x: 103, y: 0 });
  });
  it('does nothing far from every stop', () => {
    expect(resolveTap(pts, { x: 50, y: 60 }, 22)).toEqual({ kind: 'none' });
  });
});

describe('placeLabels inside the screen', () => {
  it('turns a name to the left when the right side would run off the screen', () => {
    const got = placeLabels([{ id: 'edge', x: 380, y: 100, w: 60, h: 14, priority: 1, must: true }], { w: 390, h: 800 });
    expect(got.get('edge')).toBe('left');
  });
});
