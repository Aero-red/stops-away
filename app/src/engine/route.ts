import type { Network, Route } from './types';

type Adj = Map<string, { to: string; line: string }[]>;

const adjCache = new WeakMap<Network, Adj>();

/** "station|lineA|lineB" for each through-running pair, both ways round. */
function throughSet(net: Network): Set<string> {
  const out = new Set<string>();
  for (const t of net.through ?? []) { out.add(`${t.at}|${t.a}|${t.b}`); out.add(`${t.at}|${t.b}|${t.a}`); }
  return out;
}

function adjacency(net: Network): Adj {
  let adj = adjCache.get(net);
  if (adj) return adj;
  adj = new Map();
  for (const s of net.stations) adj.set(s.id, []);
  for (const e of net.edges) {
    adj.get(e.a)?.push({ to: e.b, line: e.line });
    adj.get(e.b)?.push({ to: e.a, line: e.line });
  }
  adjCache.set(net, adj);
  return adj;
}

/**
 * Best route from `from` to `to`: fewest line changes first, then fewest stops
 * (how a rider would actually choose). Dijkstra over (station, line) states.
 * Returns null when no path exists.
 */
export function shortestRoute(net: Network, from: string, to: string): Route | null {
  const adj = adjacency(net);
  if (!adj.has(from) || !adj.has(to)) return null;
  const free = throughSet(net);
  const isChange = (at: string, l1: string, l2: string) => l1 !== l2 && !free.has(`${at}|${l1}|${l2}`);
  if (from === to) return { path: [from], stops: 0, changes: 0, lines: [] };

  // cost = changes * BIG + stops; BIG exceeds any possible stop count
  const BIG = net.stations.length + 1;
  const key = (s: string, l: string) => `${s}|${l}`;
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  // tiny network (~220 stops): a sorted array is a fine priority queue
  const queue: { k: string; s: string; l: string; c: number }[] = [];

  for (const { to: n, line } of adj.get(from)!) {
    const k = key(n, line);
    if ((dist.get(k) ?? Infinity) > 1) {
      dist.set(k, 1);
      prev.set(k, null);
      queue.push({ k, s: n, l: line, c: 1 });
    }
  }

  let best: string | null = null;
  while (queue.length) {
    queue.sort((x, y) => x.c - y.c);
    const cur = queue.shift()!;
    if (cur.c !== dist.get(cur.k)) continue;
    if (cur.s === to) { best = cur.k; break; }
    for (const { to: n, line } of adj.get(cur.s)!) {
      const c = cur.c + 1 + (isChange(cur.s, cur.l, line) ? BIG : 0);
      const k = key(n, line);
      if (c < (dist.get(k) ?? Infinity)) {
        dist.set(k, c);
        prev.set(k, cur.k);
        queue.push({ k, s: n, l: line, c });
      }
    }
  }
  if (!best) return null;

  const states: { s: string; l: string }[] = [];
  for (let k: string | null = best; k; k = prev.get(k) ?? null) {
    const [s, l] = k.split('|');
    states.unshift({ s, l });
  }
  const path = [from, ...states.map((x) => x.s)];
  const lines: string[] = [];
  let changes = 0;
  states.forEach(({ l }, i) => {
    const prev = lines[lines.length - 1];
    if (prev === l) return;
    if (prev !== undefined && isChange(path[i], prev, l)) changes++; // path[i] is where the switch happens
    lines.push(l);
  });
  return { path, stops: path.length - 1, changes, lines };
}
