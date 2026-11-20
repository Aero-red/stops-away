import type { Edge } from '../engine/types';

/** Visible map window in map units (the SVG viewBox). */
export interface View { x: number; y: number; w: number; h: number }

/** Smallest view at `aspect` (w/h) holding the bounds plus `pad` on every side, centred. */
export function fit(b: { minX: number; minY: number; maxX: number; maxY: number }, aspect: number, pad: number): View {
  let w = b.maxX - b.minX + pad * 2, h = b.maxY - b.minY + pad * 2;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  return { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h };
}

/** Zoom by `f` (>1 is in) about the map point (cx, cy), which stays put on screen. */
export function zoomAt(v: View, f: number, cx: number, cy: number, lim: { minW: number; maxW: number }): View {
  const w = Math.min(lim.maxW, Math.max(lim.minW, v.w / f));
  const s = w / v.w;
  return { x: cx - (cx - v.x) * s, y: cy - (cy - v.y) * s, w, h: v.h * s };
}

export function pan(v: View, dx: number, dy: number): View {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

/** Per edge, its side-by-side slot when n lines share one track: centred on 0. */
export function edgeSlots(edges: Edge[]): { slot: number; n: number }[] {
  const key = (e: Edge) => (e.a < e.b ? e.a + '|' + e.b : e.b + '|' + e.a);
  const groups = new Map<string, string[]>();
  for (const e of edges) groups.set(key(e), [...(groups.get(key(e)) ?? []), e.line]);
  for (const g of groups.values()) g.sort();
  return edges.map((e) => {
    const g = groups.get(key(e))!;
    return { slot: g.indexOf(e.line) - (g.length - 1) / 2, n: g.length };
  });
}

/** Whether a station is named, by zoom k (px per unit) and how many lines it has. Guessed,
 *  selected and typed-match stations are always named by the map itself. */
export function labelTier(k: number, lines: number, on: boolean, hub = false): boolean {
  if (!on) return false;
  return hub || k >= 90 || (k >= 45 && lines >= 4);
}

/** Px between side-by-side lines, so a band of n lines is at most four tracks wide. */
export function slotSpacing(n: number, track: number): number {
  return n <= 4 ? track : (track * 4) / n;
}

export interface LabelBox { id: string; x: number; y: number; w: number; h: number; priority: number; must?: boolean }
export type Side = 'right' | 'left' | 'above' | 'below';
const SIDES: Side[] = ['right', 'left', 'above', 'below'];
const GAP = 10;
function rectFor(l: LabelBox, side: Side) {
  switch (side) {
    case 'right': return { x: l.x + GAP, y: l.y - l.h / 2, w: l.w, h: l.h };
    case 'left': return { x: l.x - GAP - l.w, y: l.y - l.h / 2, w: l.w, h: l.h };
    case 'above': return { x: l.x - l.w / 2, y: l.y - GAP - l.h, w: l.w, h: l.h };
    case 'below': return { x: l.x - l.w / 2, y: l.y + GAP, w: l.w, h: l.h };
  }
}
type R = { x: number; y: number; w: number; h: number };
const hits = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Which names to draw and on which side of their stop (screen px). Must-show names always
 *  appear, on the first free side; others by priority, or not at all when no side is free. */
export function placeLabels(c: LabelBox[], screen?: { w: number; h: number }): Map<string, Side> {
  const placed: R[] = [];
  const onScreen = (r: R) => !screen || (r.x >= 0 && r.y >= 0 && r.x + r.w <= screen.w && r.y + r.h <= screen.h);
  const out = new Map<string, Side>();
  const order = [...c].sort((a, b) => Number(!!b.must) - Number(!!a.must) || b.priority - a.priority);
  for (const l of order) {
    const free = (sd: Side) => !placed.some((p) => hits(p, rectFor(l, sd)));
    const side = SIDES.find((sd) => free(sd) && onScreen(rectFor(l, sd)))
      ?? (l.must ? SIDES.find((sd) => onScreen(rectFor(l, sd))) ?? 'right' : undefined);
    if (!side) continue;
    placed.push(rectFor(l, side));
    out.set(l.id, side);
  }
  return out;
}

export type Tap = { kind: 'select'; id: string } | { kind: 'zoom'; x: number; y: number } | { kind: 'none' };

/** A tap at low zoom: the stop within reach, the clearly nearest of several, or zoom in on a tie. */
export function resolveTap(points: { id: string; x: number; y: number }[], t: { x: number; y: number }, reach: number): Tap {
  const near = points.map((p) => ({ id: p.id, d: Math.hypot(p.x - t.x, p.y - t.y) }))
    .filter((p) => p.d <= reach).sort((a, b) => a.d - b.d);
  if (!near.length) return { kind: 'none' };
  if (near.length === 1 || near[1].d > 2 * near[0].d + 2) return { kind: 'select', id: near[0].id };
  return { kind: 'zoom', x: t.x, y: t.y };
}
