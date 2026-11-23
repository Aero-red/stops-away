import { describe, expect, it } from 'vitest';
import { wheelIntent, isTrackpad } from './wheel';

// what browsers send: a Mac trackpad scroll reports wheelDelta = -3 x delta; a mouse wheel notch reports ±120
const trackpad = (dx: number, dy: number, ctrlKey = false) => ({ deltaX: dx, deltaY: dy, deltaMode: 0, ctrlKey, wheelDeltaX: -3 * dx, wheelDeltaY: -3 * dy });
const mouse = (dy: number, ctrlKey = false) => ({ deltaX: 0, deltaY: dy, deltaMode: 0, ctrlKey, wheelDeltaX: 0, wheelDeltaY: dy < 0 ? 120 : -120 });

describe('isTrackpad', () => {
  it('tells a trackpad scroll from a mouse wheel notch', () => {
    expect(isTrackpad(trackpad(6, 8))).toBe(true);
    expect(isTrackpad(trackpad(0, -3))).toBe(true);
    expect(isTrackpad(mouse(-100))).toBe(false);
    expect(isTrackpad(mouse(4))).toBe(false); // a small wheel step is still a wheel
  });
  it('without wheelDelta: line or page steps are a wheel, sideways pixels a trackpad', () => {
    expect(isTrackpad({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false })).toBe(false);
    expect(isTrackpad({ deltaX: 5, deltaY: 2, deltaMode: 0, ctrlKey: false })).toBe(true);
  });
});

describe('wheelIntent', () => {
  it('a two-finger trackpad scroll moves the map, both ways, by the finger distance', () => {
    expect(wheelIntent(trackpad(6, 8))).toEqual({ kind: 'pan', dx: 6, dy: 8 });
  });
  it('a mouse wheel notch zooms a little; up is in', () => {
    const z = wheelIntent(mouse(-100));
    expect(z.kind).toBe('zoom');
    if (z.kind === 'zoom') { expect(z.factor).toBeGreaterThan(1.1); expect(z.factor).toBeLessThan(1.25); }
  });
  it('a trackpad pinch (ctrl + small deltas) zooms at a hand-like rate: a full pinch of 100 px about doubles', () => {
    let f = 1;
    for (let i = 0; i < 25; i++) { const z = wheelIntent({ ...trackpad(0, -4, true) }); if (z.kind === 'zoom') f *= z.factor; }
    expect(f).toBeGreaterThan(2);
    expect(f).toBeLessThan(3.5);
  });
  it('ctrl + a mouse wheel notch zooms like the wheel, not like a pinch', () => {
    const z = wheelIntent(mouse(-100, true));
    expect(z.kind === 'zoom' && z.factor < 1.25).toBe(true);
  });
  it('line-based wheels (Firefox) zoom as much as a pixel notch', () => {
    const a = wheelIntent({ deltaX: 0, deltaY: -3, deltaMode: 1, ctrlKey: false });
    const b = wheelIntent(mouse(-100));
    expect(a.kind === 'zoom' && b.kind === 'zoom' && Math.abs(Math.log(a.factor) / Math.log(b.factor) - 1) < 0.5).toBe(true);
  });
  it('a stream keeps the kind it started with (a trackpad scroll never flips to zoom mid-swipe)', () => {
    expect(wheelIntent(mouse(-100), true).kind).toBe('pan');
    expect(wheelIntent(trackpad(0, 8), false).kind).toBe('zoom');
  });
});
