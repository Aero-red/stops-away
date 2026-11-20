import type { Network } from '../engine/types';

type P = { x: number; y: number };

/** Point in polygon (even-odd rule). */
export function inside(p: P, poly: P[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) hit = !hit;
  }
  return hit;
}

/** The Zone 1 / Zone 2 boundary for a layout: a ring through the stations in the 1/2 overlap,
 *  ordered by angle around Flinders Street. Any Zone 1 station left outside pulls the ring out
 *  past it (repeated until none is left), so the line always matches the stations' real zones. */
export function zoneBoundary(net: Network, layout: Record<string, P>): P[] {
  const hub = net.stations.find((s) => s.name === 'Flinders Street');
  if (!hub) return [];
  const h = layout[hub.id];
  const angle = (p: P) => Math.atan2(p.y - h.y, p.x - h.x);
  const ring = (pts: P[]) => [...pts].sort((a, b) => angle(a) - angle(b));
  let pts = net.stations.filter((s) => s.zone === '1/2').map((s) => layout[s.id]);
  for (let round = 0; round < 20; round++) {
    const poly = ring(pts);
    const out = net.stations.filter((s) => s.zone === '1' && !inside(layout[s.id], poly));
    if (!out.length) return poly;
    // a little beyond the stranded station, away from the city
    pts = [...pts, ...out.map((s) => { const p = layout[s.id]; return { x: h.x + (p.x - h.x) * 1.08, y: h.y + (p.y - h.y) * 1.08 }; })];
  }
  return ring(pts);
}
