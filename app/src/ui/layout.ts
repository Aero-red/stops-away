import type { Network, Route } from '../engine/types';

/** Schematic position of each station, in grid units. tools/layout.py (C3) will generate these. */
export type Layout = Record<string, { x: number; y: number }>;

// Hand layout for the made-up fixture network (engine/fixture.ts).
export const fixtureLayout: Layout = {
  A: { x: 0, y: 0 }, B: { x: 1, y: 0 }, C: { x: 2, y: 0 }, D: { x: 3, y: 0 }, E: { x: 4, y: 0 },
  F: { x: 2, y: 1 }, G: { x: 2, y: 2 },
};

/** Line used for each hop of a route, so the animated path takes each segment's real colour. */
export function hopLines(net: Network, route: Route): string[] {
  const out: string[] = [];
  let li = 0;
  for (let i = 0; i + 1 < route.path.length; i++) {
    const a = route.path[i], b = route.path[i + 1];
    const on = net.edges.filter((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)).map((e) => e.line);
    // stay on the current route line while this hop allows it, else move to the next one
    if (!on.includes(route.lines[li]) && on.includes(route.lines[li + 1])) li++;
    out.push(on.includes(route.lines[li]) ? route.lines[li] : on[0]);
  }
  return out;
}

export type Dir = 'up' | 'down' | 'left' | 'right';
const VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Neighbour along a track that best matches an arrow key, or null. */
export function neighbourInDirection(net: Network, layout: Layout, from: string, dir: Dir): string | null {
  const p = layout[from];
  const [dx, dy] = VEC[dir];
  let best: string | null = null;
  let bestScore = 0.3; // must point roughly the right way
  for (const e of net.edges) {
    const n = e.a === from ? e.b : e.b === from ? e.a : null;
    if (!n || !layout[n]) continue;
    const vx = layout[n].x - p.x, vy = layout[n].y - p.y;
    const s = (vx * dx + vy * dy) / Math.hypot(vx, vy);
    if (s > bestScore) { bestScore = s; best = n; }
  }
  return best;
}

/** Angle (degrees, screen axes) of a station's tick: across the average direction of its track.
 *  Directions are averaged with doubled angles, so a track and its reverse count as the same. */
export function tickAngle(id: string, edges: { a: string; b: string; line: string }[], layout: Layout): number {
  const p = layout[id];
  let sx = 0, sy = 0;
  for (const e of edges) {
    const n = e.a === id ? e.b : e.b === id ? e.a : null;
    if (!n || !layout[n]) continue;
    const phi = Math.atan2(layout[n].y - p.y, layout[n].x - p.x);
    sx += Math.cos(2 * phi);
    sy += Math.sin(2 * phi);
  }
  return (Math.atan2(sy, sx) / 2) * (180 / Math.PI) + 90;
}
