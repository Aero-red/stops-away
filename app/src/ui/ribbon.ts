// Drawing a line as continuous ribbons with rounded corners, transit-diagram style.

type E = { a: string; b: string; line: string };
type P = { x: number; y: number };

/** The line's stations as continuous runs: split at junctions and line ends, each track drawn
 *  once; a loop with no junction (the City Loop on its own) is one run that closes on itself. */
export function lineRuns(edges: E[], line: string): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of edges) if (e.line === line) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }
  const used = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const walk = (start: string, next: string, stopAt: (n: string) => boolean) => {
    const run = [start];
    let prev = start, cur = next;
    while (true) {
      used.add(key(prev, cur));
      run.push(cur);
      if (stopAt(cur)) break;
      const nx = adj.get(cur)!.find((n) => !used.has(key(cur, n)));
      if (!nx) break;
      prev = cur; cur = nx;
    }
    return run;
  };
  const breaks = (n: string) => adj.get(n)!.length !== 2;
  const runs: string[][] = [];
  for (const n of [...adj.keys()].sort()) if (breaks(n))
    for (const m of adj.get(n)!) if (!used.has(key(n, m))) runs.push(walk(n, m, breaks));
  for (const n of [...adj.keys()].sort()) // what is left are loops
    for (const m of adj.get(n)!) if (!used.has(key(n, m))) runs.push(walk(n, m, (x) => x === n));
  return runs;
}

const fmt = (n: number) => String(+n.toFixed(2));

/** An SVG path through the points with every corner rounded (cut back by up to r on each side,
 *  never more than half a segment, joined with a curve through the corner). */
export function roundedPath(points: P[], r: number): string {
  // drop points in the middle of a straight run
  const pts = points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const a = points[i - 1], b = points[i + 1];
    const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
    const dot = (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y);
    return Math.abs(cross) > 1e-9 || dot < 0;
  });
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], v = pts[i], b = pts[i + 1];
    const l1 = Math.hypot(v.x - a.x, v.y - a.y), l2 = Math.hypot(b.x - v.x, b.y - v.y);
    const cut = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: v.x - ((v.x - a.x) / l1) * cut, y: v.y - ((v.y - a.y) / l1) * cut };
    const p2 = { x: v.x + ((b.x - v.x) / l2) * cut, y: v.y + ((b.y - v.y) / l2) * cut };
    d += `L${fmt(p1.x)} ${fmt(p1.y)}Q${fmt(v.x)} ${fmt(v.y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  const z = pts[pts.length - 1];
  return d + `L${fmt(z.x)} ${fmt(z.y)}`;
}

/** Each segment shifted sideways by its own offset (the same sense as MapSvg's parallel tracks),
 *  consecutive segments joined at the point where their shifted lines meet (the mitre). Where two
 *  segments run parallel at different offsets (a line moving lanes), both ends are kept. */
export function offsetPolyline(segs: { p: P; q: P; o: number }[]): P[] {
  const shifted = segs.map(({ p, q, o }) => {
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = (-(q.y - p.y) / len) * o, ny = ((q.x - p.x) / len) * o;
    return { p: { x: p.x + nx, y: p.y + ny }, q: { x: q.x + nx, y: q.y + ny } };
  });
  const out: P[] = [shifted[0].p];
  for (let i = 1; i < shifted.length; i++) {
    const a = shifted[i - 1], b = shifted[i];
    const d1 = { x: a.q.x - a.p.x, y: a.q.y - a.p.y }, d2 = { x: b.q.x - b.p.x, y: b.q.y - b.p.y };
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-9) {
      out.push(a.q);
      if (Math.hypot(a.q.x - b.p.x, a.q.y - b.p.y) > 1e-9) out.push(b.p);
      continue;
    }
    const t = ((b.p.x - a.p.x) * d2.y - (b.p.y - a.p.y) * d2.x) / den;
    const m = { x: a.p.x + d1.x * t, y: a.p.y + d1.y * t };
    // mitre limit: a joint more than 2 lane widths from where the segments end is a near-parallel
    // or doubling-back corner; keep both ends instead of shooting off
    const lim = 2 * Math.max(Math.abs(segs[i - 1].o), Math.abs(segs[i].o), 1e-6);
    if (Math.hypot(m.x - a.q.x, m.y - a.q.y) > lim || Math.hypot(m.x - b.p.x, m.y - b.p.y) > lim) {
      out.push(a.q);
      out.push(b.p);
    } else out.push(m);
  }
  out.push(shifted[shifted.length - 1].q);
  return out;
}
