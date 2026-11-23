<script lang="ts">
  import { flushSync, untrack } from 'svelte';
  import type { Network } from '../engine/types';
  import type { Feedback } from '../engine/modes/types';
  import { hopLines, neighbourInDirection, tickAngle, type Dir, type Layout } from './layout';
  import { edgeSlots, fit, labelTier, pan, placeLabels, resolveTap, slotSpacing, zoomAt, type Side, type View } from './viewport';
  import { isTrackpad, wheelIntent } from './wheel';
  import { warmth, type Warmth } from '../engine/warmth';
  import Basemap from './Basemap.svelte';
  import { mapReveal } from './reveal';
  import { lineRuns, offsetPolyline, roundedPath } from './ribbon';
  import { zoneBoundary } from './zones';
  import type { World } from './basemap';

  interface Props {
    net: Network;
    layout: Layout;
    guesses: Feedback[];
    selected: string | null;
    glow: Set<string>;
    labels: boolean;
    plain?: boolean; // Hard: no names anywhere (stop card, labels, street map); colours stay
    nameless?: boolean; // Connect / Line Run: only the start, the goal, stops reached and `named` are named
    named?: Set<string>; // Line Run: stations already found
    bends?: Record<string, [number, number][]>; // diagram: bend points of a track between two stations ("a|b", a < b)
    world?: World; // real map: draw street tiles underneath, lined up with these units
    diagram?: boolean; // diagram look: station ticks, interchange capsules, bold line ends
    areas?: Record<string, [number, number][]>; // diagram background: bay outline and label point
    context?: { net: Network; layout: Layout; bends: Record<string, [number, number][]> }; // the other network, faint, not playable
    home?: string[]; // stations the map opens on (the city); "Show whole map" still shows everything
    trail?: string[]; // Connect: the player's path so far
    spotlight?: string; // Line Run: the one line lit up
    collect?: { seen: Set<string>; found: Set<string> }; // My map: stations met across games
    ends?: { from: string; to: string }; // Connect: start and goal
    you?: string; // Connect: where the player is now
    frame?: { key: string; ids: string[] }; // fly to show these stations whenever the key changes
    over?: boolean; // game finished: journeys may be drawn
    focus?: string | null; // a guess picked in the history (default: the latest)
    onselect: (id: string | null) => void;
  }
  let { net, layout, guesses, selected, glow, labels, plain = false, nameless = false, named, bends = {}, world, diagram = false, areas = {}, context, home, trail, ends, spotlight, you, frame, collect, over = false, focus = null, onselect }: Props = $props();

  // ---- viewport: the SVG viewBox in map units; k = screen px per map unit
  let svg: SVGSVGElement;
  let stage: HTMLDivElement;
  let size = $state({ w: 1, h: 1 });
  // Two views: `live` follows the player's hand (and the street map with it); `view` is what the SVG is drawn for.
  // The SVG is redrawn at most once per animation frame, however many input events arrive (a Mac trackpad sends
  // several per frame; redrawing for each made movement stutter). A device too slow to redraw every frame redraws
  // less often, and in between the drawn map is slid and scaled as one picture (user, 2026-11-23: "not smooth",
  // then "zoom jumps in steps" when redraws waited for the hand to rest).
  let live = $state<View>({ x: 0, y: 0, w: 1, h: 1 });
  let view = $state<View>({ x: 0, y: 0, w: 1, h: 1 });
  const k = $derived(size.w / view.w);   // drawn scale: everything inside the SVG
  const kl = $derived(size.w / live.w);  // live scale: input and the street map
  const same = (a: View, b: View) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  let raf = 0, nextAt = 0;
  function redraw(t: number) {
    raf = 0;
    if (same(live, view)) return;
    if (t < nextAt) { raf = requestAnimationFrame(redraw); return; }
    const t0 = performance.now();
    flushSync(() => { view = live; });
    const cost = performance.now() - t0;
    nextAt = cost > 12 ? t + cost * 2 : 0; // slow redraw: skip frames, the picture slides in between
  }
  $effect(() => {
    const l = live, v = untrack(() => view);
    if (same(l, v)) return;
    // the first view, or a new shape (resize): draw at once, never a stretched picture
    if (v.w === 1 || Math.abs(v.h / v.w - l.h / l.w) > 1e-9) { view = l; return; }
    if (!raf) raf = requestAnimationFrame(redraw);
  });
  $effect(() => () => cancelAnimationFrame(raf));
  // the drawn picture, slid and scaled onto the live view
  const shift = $derived.by(() => {
    if (live.x === view.x && live.y === view.y && live.w === view.w) return 'none';
    return `translate(${(view.x - live.x) * kl}px, ${(view.y - live.y) * kl}px) scale(${view.w / live.w})`;
  });
  const bounds = $derived.by(() => {
    const ps = Object.values(layout);
    return { minX: Math.min(...ps.map((p) => p.x)), minY: Math.min(...ps.map((p) => p.y)),
             maxX: Math.max(...ps.map((p) => p.x)), maxY: Math.max(...ps.map((p) => p.y)) };
  });
  const limits = $derived({ minW: 1.5, maxW: (bounds.maxX - bounds.minX) * 2 + 4 });
  let flight = 0;        // bumped by every player action, so an in-flight fly gives way
  let touched = false;   // has the player moved the map yet?
  const reset = () => { flight++; live = fit(bounds, size.w / size.h, 0.6); };
  // the opening view: the home stations (the city), or everything when none are given
  const homeBounds = $derived.by(() => {
    const ps = (home ?? []).map((id) => layout[id]).filter(Boolean);
    if (ps.length < 2) return null;
    return { minX: Math.min(...ps.map((p) => p.x)), minY: Math.min(...ps.map((p) => p.y)),
             maxX: Math.max(...ps.map((p) => p.x)), maxY: Math.max(...ps.map((p) => p.y)) };
  });
  const goHome = () => { flight++; live = fit(homeBounds ?? bounds, size.w / size.h, 0.6); };

  let fittedFor: Layout | null = null;
  $effect(() => {
    if (size.w > 1 && layout !== fittedFor) { fittedFor = layout; goHome(); }
  });

  $effect(() => {
    const ro = new ResizeObserver(([e]) => {
      const first = size.w === 1;
      size = { w: e.contentRect.width || 1, h: e.contentRect.height || 1 };
      if (first) { fittedFor = layout; goHome(); }
      else if (!touched) goHome(); // the layout settled (e.g. the panel grew): back to the opening view
      else live = { ...live, h: live.w * (size.h / size.w) }; // the player chose this view: keep its scale
    });
    ro.observe(svg);
    return () => ro.disconnect();
  });

  const toMap = (cx: number, cy: number) => {
    const r = stage.getBoundingClientRect(); // not the SVG's: it is transformed while the hand moves
    return { x: live.x + ((cx - r.left) / r.width) * live.w, y: live.y + ((cy - r.top) / r.height) * live.h };
  };
  const zoomBy = (f: number, cx?: number, cy?: number) => {
    flight++; touched = true;
    const c = cx === undefined ? { x: live.x + live.w / 2, y: live.y + live.h / 2 } : toMap(cx, cy!);
    live = zoomAt(live, f, c.x, c.y, limits);
  };

  // drag to pan, two fingers to pinch; a drag never counts as a tap
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let dragged = false;
  let pinched = false;
  let vel = { x: 0, y: 0, t: 0 }; // finger speed in px/ms, for the glide after a flick
  function down(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { moved = 0; dragged = false; pinched = false; vel = { x: 0, y: 0, t: e.timeStamp }; }
    flight++; // a finger on the map stops any glide or fly
  }
  function move(e: PointerEvent) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
      if (moved > 6) {
        if (!dragged) stage.setPointerCapture(e.pointerId);
        dragged = true;
        flight++; touched = true;
        live = pan(live, -(e.clientX - p.x) / kl, -(e.clientY - p.y) / kl);
        const dt = Math.max(1, e.timeStamp - vel.t), a = Math.min(1, dt / 50); // smoothed over ~50 ms
        vel = { x: vel.x * (1 - a) + ((e.clientX - p.x) / dt) * a, y: vel.y * (1 - a) + ((e.clientY - p.y) / dt) * a, t: e.timeStamp };
      }
    } else if (pointers.size === 2) {
      // pinch and two-finger drag together: zoom by the change in finger spread about the old
      // midpoint, then move the map so the point that was under the midpoint follows it
      const [o] = [...pointers.entries()].filter(([id]) => id !== e.pointerId).map(([, q]) => q);
      const before = Math.hypot(p.x - o.x, p.y - o.y), after = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      const m0 = { x: (p.x + o.x) / 2, y: (p.y + o.y) / 2 }, m1 = { x: (e.clientX + o.x) / 2, y: (e.clientY + o.y) / 2 };
      if (before > 0) {
        flight++; touched = true;
        const c = toMap(m0.x, m0.y);
        const z = zoomAt(live, after / before, c.x, c.y, limits);
        const k2 = size.w / z.w;
        live = pan(z, -(m1.x - m0.x) / k2, -(m1.y - m0.y) / k2);
      }
      dragged = true; pinched = true;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    // a flick keeps the map gliding a little, slowing to a stop (not after a pinch, a slow drag, or with reduced motion)
    if (pointers.size || !dragged || pinched || reduce || e.timeStamp - vel.t > 80) return;
    const { x: vx, y: vy } = vel;
    const speed = Math.hypot(vx, vy);
    if (speed < 0.3) return;
    // exponential ease-out by the clock, so a slow device glides the same distance in the same time
    const TAU = 250, END = TAU * Math.log((speed * TAU) / 0.5); // stops when under half a pixel is left
    const me = ++flight;
    const t0 = performance.now(), kk = kl;
    let done = 0;
    const step = (t: number) => {
      if (me !== flight) return;
      const u = Math.min(END, t - t0), f = 1 - Math.exp(-u / TAU);
      live = pan(live, -(vx * TAU * (f - done)) / kk, -(vy * TAU * (f - done)) / kk);
      done = f;
      if (u < END) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  // iOS Safari: a pinch on the map must zoom the map, never the whole page
  $effect(() => {
    const stop = (e: Event) => e.preventDefault();
    stage.addEventListener('gesturestart', stop);
    stage.addEventListener('gesturechange', stop);
    return () => { stage.removeEventListener('gesturestart', stop); stage.removeEventListener('gesturechange', stop); };
  });
  // mouse wheel zooms; a two-finger trackpad scroll moves the map; a trackpad pinch (ctrl + wheel) zooms.
  // One scroll keeps the kind it started as, so a swipe's tail never turns into a zoom.
  let stream = { t: -Infinity, pad: false };
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const w = e as WheelEvent & { wheelDeltaX?: number; wheelDeltaY?: number };
    if (!e.ctrlKey) { // a pinch is its own gesture: it neither starts nor extends a scroll
      if (e.timeStamp - stream.t > 200) stream.pad = isTrackpad(w);
      stream.t = e.timeStamp;
    }
    const it = wheelIntent(w, stream.pad);
    if (it.kind === 'zoom') { zoomBy(it.factor, e.clientX, e.clientY); return; }
    flight++; touched = true;
    live = pan(live, it.dx / kl, it.dy / kl);
  }

  // ---- drawing
  const TRACK = $derived(diagram ? 5 : 4); // px

  // diagram look: how many tracks meet at each station, and which way its tick points
  const degree = $derived.by(() => {
    const d = new Map<string, Set<string>>();
    for (const e of net.edges) {
      d.set(e.a, (d.get(e.a) ?? new Set()).add(e.b));
      d.set(e.b, (d.get(e.b) ?? new Set()).add(e.a));
    }
    return new Map([...d].map(([k, v]) => [k, v.size]));
  });
  const zoneRing = $derived(zoneBoundary(net, layout));
  // context network: each track once (lines sharing a track draw as one), plus its line-end names
  const ctxTracks = $derived.by(() => {
    if (!context) return [];
    const seen = new Map<string, { key: string; d: string; colour: string }>();
    for (const e of context.net.edges) {
      const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
      if (seen.has(key) || !context.layout[e.a] || !context.layout[e.b]) continue;
      const mid = (context.bends[key] ?? []).map(([x, y]) => ({ x, y }));
      const ptsList = [context.layout[e.a], ...(e.a < e.b ? mid : [...mid].reverse()), context.layout[e.b]];
      seen.set(key, { key, d: pts(ptsList), colour: context.net.lines.find((l) => l.id === e.line)?.colour ?? 'var(--muted)' });
    }
    return [...seen.values()];
  });
  const ctxEnds = $derived.by(() => {
    if (!context || plain) return [];
    const deg = new Map<string, number>();
    const pairs = new Set(context.net.edges.map((e) => (e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`)));
    for (const p of pairs) for (const id of p.split('|')) deg.set(id, (deg.get(id) ?? 0) + 1);
    return context.net.stations.filter((s) => deg.get(s.id) === 1 && !byId[s.id] && context.layout[s.id])
      .map((s) => ({ id: s.id, name: s.name.toUpperCase(), ...context.layout[s.id] }));
  });
  const LOOP = new Set(['Flinders Street', 'Southern Cross', 'Flagstaff', 'Melbourne Central', 'Parliament']);
  const mark = $derived.by(() => new Map(net.stations.map((s) => {
    const deg = degree.get(s.id) ?? 0;
    const kind = deg >= 3 || LOOP.has(s.name) ? 'capsule' : s.lines.length > 1 ? 'shared' : 'tick';
    return [s.id, { kind, angle: tickAngle(s.id, net.edges, layout), end: deg === 1 }];
  })));
  const colour = $derived(Object.fromEntries(net.lines.map((l) => [l.id, l.colour])));
  const byId = $derived(Object.fromEntries(net.stations.map((s) => [s.id, s])));
  const guessed = $derived(new Map(guesses.map((g) => [g.stationId, g])));
  const slots = $derived(edgeSlots(net.edges));

  type P = { x: number; y: number };
  /** a -> b through the diagram's bend points, if any */
  function trackPoints(a: string, b: string): P[] {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const mid = (bends[key] ?? []).map(([x, y]) => ({ x, y }));
    return [layout[a], ...(a < b ? mid : [...mid].reverse()), layout[b]];
  }
  /** each straight run of a track, shifted sideways into its slot when lines share the track */
  function offsetRuns(pts: P[], { slot, n }: { slot: number; n: number }) {
    const o = (slot * slotSpacing(n, TRACK)) / k;
    return pts.slice(1).map((b, i) => {
      const a = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (-(b.y - a.y) / len) * o, ny = ((b.x - a.x) / len) * o;
      return { x1: a.x + nx, y1: a.y + ny, x2: b.x + nx, y2: b.y + ny };
    });
  }
  const pts = (ps: P[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');

  // diagram look: each line as continuous ribbons, in its lane on shared track, corners rounded
  const RADIUS = 16; // px
  const slotOf = $derived(new Map(net.edges.map((e, i) => [`${e.a < e.b ? e.a + '|' + e.b : e.b + '|' + e.a}|${e.line}`, slots[i]])));
  const runs = $derived(diagram ? net.lines.flatMap((l) => lineRuns(net.edges, l.id).map((r) => ({ line: l.id, r }))) : []);
  function ribbon(line: string, run: string[]) {
    const segs = run.slice(1).flatMap((b, i) => {
      const a = run[i];
      const sl = slotOf.get(`${a < b ? a + '|' + b : b + '|' + a}|${line}`) ?? { slot: 0, n: 1 };
      const o = (sl.slot * slotSpacing(sl.n, TRACK)) / k;
      const tp = trackPoints(a, b);
      return tp.slice(1).map((q, j) => ({ p: tp[j], q, o }));
    });
    return roundedPath(offsetPolyline(segs), RADIUS / k);
  }

  let hovered = $state<string | null>(null);
  // what the map may show (never a route mid-game: a route ends at the answer)
  const reveal = $derived(mapReveal(guesses, over, focus, plain)); // Hard: no lines told
  const lit = $derived.by(() => {
    const id = hovered ?? selected;
    if (id) return new Set(byId[id].lines);
    if (spotlight) return new Set([spotlight]);
    return reveal.litLines.size ? reveal.litLines : null;
  });
  const told = $derived(!hovered && !selected && (reveal.litLines.size > 0 || !!spotlight)); // lit = what a guess told you, or the Line Run line

  // each guess against the best before it (user decision 2026-11-19)
  const warm = $derived.by(() => {
    const w = warmth(guesses);
    return new Map<string, Warmth>(guesses.map((g, i) => [g.stationId, w[i]]));
  });

  // the drawn journey, only once the game is over: the last guess's (or the one picked in the history)
  const last = $derived(over ? (guesses.find((g) => g.stationId === focus && g.route && g.route.stops > 0) ?? reveal.routes.at(-1)) : undefined);
  const hops = $derived(last?.route && last.route.stops > 0 ? hopLines(net, last.route) : []);
  const changeStops = $derived(hops.slice(1).flatMap((l, i) => (l !== hops[i] ? [last!.route!.path[i + 1]] : [])).filter((id) => layout[id]));
  // every earlier guess keeps a thin trail in its warmth colour, so the map records the hunt
  const routePoints = (path: string[]) => path.slice(1).flatMap((b, i) => trackPoints(path[i], b).slice(i ? 1 : 0));
  const ghosts = $derived(reveal.routes.filter((g) => g !== last)
    .map((g) => ({ id: g.stationId, w: warm.get(g.stationId)!, d: pts(routePoints(g.route!.path)) })));

  const hub = $derived(net.stations.find((s) => s.name === 'Flinders Street')?.id);
  const onTrail = $derived(new Set(trail ?? []));
  const known = (id: string) => onTrail.has(id) || ends?.from === id || ends?.to === id || !!named?.has(id);
  const must = (id: string) => nameless ? known(id)
    : !!collect?.seen.has(id) || guessed.has(id) || (selected === id && !plain && labels) || glow.has(id) || known(id);
  // names that would overlap on screen give way to the more important one (more lines, the hub)
  const shown = $derived.by(() => {
    const c = net.stations
      .filter((s) => must(s.id) || (!nameless && labelTier(diagram ? 999 : k, s.lines.length, labels, s.id === hub)))
      .map((s) => ({
        id: s.id, x: (layout[s.id].x - view.x) * k, y: (layout[s.id].y - view.y) * k,
        w: s.name.length * 7 + 4, h: 15, priority: (s.id === hub ? 100 : 0) + s.lines.length, must: must(s.id),
      }));
    return placeLabels(c, size);
  });
  // where a label sits around its dot, in screen px inside the counter-scaled stop group
  const LABEL_AT: Record<Side, { x: number; y: number; anchor: string }> = {
    right: { x: 10, y: 4, anchor: 'start' }, left: { x: -10, y: 4, anchor: 'end' },
    above: { x: 0, y: -12, anchor: 'middle' }, below: { x: 0, y: 21, anchor: 'middle' },
  };

  // a real tap goes to the nearest stop; two about equally near zoom in instead of guessing
  const REACH = 22;
  function tap(e: MouseEvent, direct?: string) {
    if (dragged) return;
    if (direct && e.detail === 0) { onselect(direct); return; } // keyboard or scripted activation
    const r = stage.getBoundingClientRect();
    const t = { x: e.clientX - r.left, y: e.clientY - r.top };
    const pts = net.stations.map((s) => ({ id: s.id, x: (layout[s.id].x - live.x) * kl, y: (layout[s.id].y - live.y) * kl }));
    const res = resolveTap(pts, t, REACH);
    if (res.kind === 'select') onselect(res.id);
    else if (res.kind === 'zoom') zoomBy(2.5, e.clientX, e.clientY);
    else onselect(null);
  }

  // one stop in the tab order (roving tabindex); arrows move along the tracks
  let focusId = $state<string | null>(null);
  const tabStop = $derived(selected ?? focusId ?? hub);

  // the winning guess, once the game is over
  const found = $derived(over ? guesses.find((g) => g.correct) : undefined);

  // a short word at the new guess: warmer, colder, same, found
  let callout = $state<{ id: string; text: string; w: string; n: number } | null>(null);
  let seen = untrack(() => guesses.length); // a restored game starts quiet: only new guesses get a callout
  $effect(() => {
    const n = guesses.length;
    if (n <= seen) { if (n < seen) callout = null; seen = n; return; } // a new game or mode: drop the old bubble
    seen = n;
    const g = guesses[n - 1];
    const w = warm.get(g.stationId)!;
    const stops = g.route?.stops;
    const text = g.correct ? 'Found it!' : w === 'warmer' ? `Warmer · ${stops} stops` : w === 'colder' ? `Colder · ${stops} stops`
      : w === 'same' ? `Same · ${stops} stops` : `${stops} stops away`;
    callout = { id: g.stationId, text, w, n };
    const t = setTimeout(() => { if (callout?.n === n) callout = null; }, 2200);
    return () => clearTimeout(t);
  });

  // fly the map: to the lines a guess lit (or a picked history row), and at the end to the whole hunt
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function flyTo(ids: string[]) {
    const ps = ids.map((id) => layout[id]).filter(Boolean);
    if (!ps.length || size.w <= 1) return;
    const b = { minX: Math.min(...ps.map((p) => p.x)), minY: Math.min(...ps.map((p) => p.y)),
                maxX: Math.max(...ps.map((p) => p.x)), maxY: Math.max(...ps.map((p) => p.y)) };
    const goal = fit(b, size.w / size.h, 1.2);
    const from = { ...live };
    if (reduce) { live = goal; return; }
    const t0 = performance.now();
    const me = ++flight;
    touched = true;
    const step = (t: number) => {
      if (me !== flight) return; // the player panned, zoomed or reset: their view wins
      const u = Math.min(1, (t - t0) / 650), e = 1 - Math.pow(1 - u, 3);
      live = { x: from.x + (goal.x - from.x) * e, y: from.y + (goal.y - from.y) * e,
               w: from.w + (goal.w - from.w) * e, h: from.h + (goal.h - from.h) * e };
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // an explicit frame (Connect): fly whenever its key changes, e.g. after each move
  let framedFor = '';
  $effect(() => {
    if (!frame || size.w <= 1) return;
    if (frame.key === framedFor) return;
    framedFor = frame.key;
    flyTo(frame.ids);
  });
  let flownFor = '';
  $effect(() => {
    const key = `${guesses.length}|${focus}|${over}`;
    if (key === flownFor || !guesses.length) { flownFor = key; return; }
    flownFor = key;
    if (over) flyTo(guesses.flatMap((g) => g.route?.path ?? [g.stationId]));
    else if (reveal.focus) {
      // the focused guess plus every station on the lines it lit: the area the clue points at
      const ids = net.stations.filter((s) => s.lines.some((l) => reveal.litLines.has(l))).map((s) => s.id);
      flyTo([reveal.focus, ...ids]);
    }
  });

  // plain stop radius in screen px: small when zoomed out, full size from about 90 px per unit
  const dotR = $derived(Math.min(4.5, Math.max(2.4, k * 0.05)));

  const PATH_MS = 600;
  const nodes: Record<string, SVGGElement> = $state({});
  function onKey(e: KeyboardEvent, id: string) {
    const dirs: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(id); return; }
    if (e.key === 'Escape') { onselect(null); return; }
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    const n = neighbourInDirection(net, layout, id, d);
    if (n) { focusId = n; nodes[n]?.focus(); }
  }
</script>

<div class="wrap">
  {#if world && size.w > 1}
    <Basemap view={live} {size} {world} plain={plain || nameless} />
  {/if}
  <!-- clicking empty map closes the stop card; keyboard users close it with Escape on a stop -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <!-- input lands on the stage, which never moves; the SVG inside slides and scales while the hand moves -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div bind:this={stage} class="stage" data-view="{live.x} {live.y} {live.w} {live.h}"
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel}
    onclick={(e) => tap(e)}>
  <svg bind:this={svg} class="map" viewBox="{view.x} {view.y} {view.w} {view.h}" role="group" aria-label="Network map"
    style:transform={shift}>
    {#if diagram && areas.bay}
      <!-- a calm background: striped water (Port Phillip, Western Port) and a faint Yarra -->
      <defs>
        <pattern id="waves" width="10" height="7" patternUnits="userSpaceOnUse" patternTransform="scale({1 / k})">
          <line x1="0" y1="3.5" x2="10" y2="3.5" class="wave" />
        </pattern>
      </defs>
      <g class="areas" aria-hidden="true">
        <path class="water" d={roundedPath([...areas.bay, areas.bay[0], areas.bay[1]].map(([x, y]) => ({ x, y })), 24 / k) + 'Z'} />
        <path class="water waves" d={roundedPath([...areas.bay, areas.bay[0], areas.bay[1]].map(([x, y]) => ({ x, y })), 24 / k) + 'Z'} />
        {#if areas.westernport}
          {@const wp = [...areas.westernport, areas.westernport[0], areas.westernport[1]].map(([x, y]) => ({ x, y }))}
          <path class="water" d={roundedPath(wp, 24 / k) + 'Z'} />
          <path class="water waves" d={roundedPath(wp, 24 / k) + 'Z'} />
        {/if}
        {#if areas.yarra}
          <path class="river" d={roundedPath(areas.yarra.map(([x, y]) => ({ x, y })), 20 / k)} stroke-width={2.4 / k} />
        {/if}
        {#if areas.yarra_label}
          <text class="landmark water-label small" transform="translate({areas.yarra_label[0][0]} {areas.yarra_label[0][1]}) scale({1 / k}) rotate(-56)">Yarra River</text>
        {/if}
        {#if areas.bay_label}
          <text class="area-label water-label" transform="translate({areas.bay_label[0][0]} {areas.bay_label[0][1]}) scale({1 / k})">Port Phillip Bay</text>
        {/if}
      </g>
    {/if}

    {#if zoneRing.length}
      {@const top = zoneRing.reduce((a, b) => (b.y < a.y ? b : a))}
      <!-- fare zones: the Zone 1 / Zone 2 boundary, worked out from every station's zone -->
      <g class="zones" aria-hidden="true">
        <path class="zone-line" d={roundedPath([...zoneRing, zoneRing[0], zoneRing[1]], 30 / k) + 'Z'} stroke-width={1.6 / k}
          stroke-dasharray="{4 / k} {4 / k}" />
        <text class="zone-label" transform="translate({top.x} {top.y}) scale({1 / k})" dy="16">ZONE 1</text>
        <text class="zone-label" transform="translate({top.x} {top.y}) scale({1 / k})" dy="-8">ZONE 2</text>
      </g>
    {/if}

    {#if context}
      <!-- the other network (V/Line on the metro game, metro on the Regional one): faint, for orientation -->
      <g class="context" aria-hidden="true">
        {#each ctxTracks as t (t.key)}
          <polyline points={t.d} stroke={t.colour} stroke-width={(diagram ? 3 : 2.5) / k} />
        {/each}
        {#each ctxEnds as e (e.id)}
          <text class="ctx-label" transform="translate({e.x} {e.y}) scale({1 / k})" x="8" dy="4">{e.name}</text>
        {/each}
      </g>
    {/if}

    <g class="tracks">
      {#if diagram}
        {#each runs as { line, r }, i (line + i)}
          <path class="ribbon" d={ribbon(line, r)} stroke={colour[line]} data-line={line}
            stroke-width={(told && lit?.has(line) ? 1.7 : 1) * TRACK / k}
            class:dim={lit && !lit.has(line) && !told} class:faint={(told && !lit?.has(line)) || over} class:on={told && lit?.has(line)} />
        {/each}
      {:else}
      {#each net.edges as e, i (e.a + e.b + e.line)}
        {#each offsetRuns(trackPoints(e.a, e.b), slots[i]) as run, j (j)}
          <line {...run} stroke={colour[e.line]} data-line={e.line} stroke-width={(told && lit?.has(e.line) ? 1.7 : 1) * TRACK / k}
            class:dim={lit && !lit.has(e.line) && !told} class:faint={(told && !lit?.has(e.line)) || over} class:on={told && lit?.has(e.line)} />
        {/each}
      {/each}
      {/if}
    </g>

    <g class="ghosts" aria-hidden="true">
      {#each ghosts as gh, i (gh.id)}
        <!-- on a win the journeys draw themselves in, one after another, into the found station -->
        <polyline class="ghost {gh.w}" class:drawin={!!found} pathLength="1" points={gh.d} stroke-width={6 / k}
          style="--d:{500 + i * 260}ms" />
      {/each}
    </g>

    {#key guesses.length}
      <g class="route" aria-hidden="true">
        {#each hops as line, i (i)}
          <polyline points={pts(trackPoints(last!.route!.path[i], last!.route!.path[i + 1]))} stroke={colour[line]}
            stroke-width={12 / k} pathLength="1" style="--d:{(i * PATH_MS) / hops.length}ms; --t:{PATH_MS / hops.length}ms" />
        {/each}
        {#each changeStops as id (id)}
          <circle class="pulse" cx={layout[id].x} cy={layout[id].y} r={14 / k} stroke-width={3 / k}
            style="--d:{PATH_MS}ms" />
        {/each}
      </g>
    {/key}

    {#each net.stations as s (s.id)}
      {@const p = layout[s.id]}
      {@const g = guessed.get(s.id)}
      {@const w = warm.get(s.id)}
      {@const inter = s.lines.length > 1}
      <g bind:this={nodes[s.id]} id="stop-{s.id}" class="stop" transform="translate({p.x} {p.y}) scale({1 / k})"
        tabindex={s.id === tabStop ? 0 : -1} role="button"
        aria-label="{(plain && !g) || (nameless && !known(s.id)) || (!labels && !nameless && !must(s.id)) ? 'Stop' : s.name}{g ? `, guessed, ${g.correct ? 'correct' : `${g.route?.stops} stops away`}` : ''}"
        aria-pressed={selected === s.id}
        class:selected={selected === s.id} class:glow={glow.has(s.id)}
        class:dim={lit && !g && !s.lines.some((l) => lit.has(l))}
        class:off={(over && !reveal.endStops.has(s.id)) || (!!collect && !collect.seen.has(s.id))}
        class:got={!!collect?.found.has(s.id)} class:met={!!collect?.seen.has(s.id) && !collect?.found.has(s.id)}
        onclick={(e) => { e.stopPropagation(); tap(e, s.id); }} onkeydown={(e) => onKey(e, s.id)}
        onpointerenter={() => (hovered = s.id)} onpointerleave={() => (hovered = null)}
        onfocus={() => { hovered = s.id; focusId = s.id; }} onblur={() => (hovered = null)}>
        <circle class="hit" r="14" />
        {#if g}
          <circle class="dot {w}" class:pop={g === guesses.at(-1)} r="11" />
          {#if g.correct}
            <path class="tick" d="M-5 0.5 L-1.5 4 L5 -3.5" />
          {:else}
            <text class="count {w}" dy="4">{g.route?.stops ?? '?'}</text>
          {/if}
        {:else if diagram}
          {@const m = mark.get(s.id)!}
          {@const span = (s.lines.length > 1 ? s.lines.length * slotSpacing(s.lines.length, TRACK) : TRACK) + 5}
          <g transform="rotate({m.angle})">
            {#if m.kind === 'capsule'}
              <rect class="capsule" x={-span / 2 - 1} y="-4" width={span + 2} height="8" rx="4" />
            {:else}
              <!-- one line: a tick in its colour standing out to one side; shared track: dark, across the bundle -->
              <line class="stn-tick" class:shared={m.kind === 'shared'}
                x1={m.kind === 'tick' ? 0 : -span / 2} x2={m.kind === 'tick' ? TRACK / 2 + 5 : span / 2}
                stroke={m.kind === 'tick' ? colour[s.lines[0]] : undefined} />
            {/if}
          </g>
        {:else}
          <circle class="dot" class:ring={inter} r={(inter ? 1.3 : 1) * dotR} />
        {/if}
      </g>
    {/each}


    {#if found}
      {@const fp = layout[found.stationId]}
      {@const cols = [...byId[found.stationId].lines.map((l) => colour[l]), 'var(--hit)']}
      <!-- found it: ripples and a burst in the station's line colours -->
      {#key found.stationId}
        <g class="win" transform="translate({fp.x} {fp.y}) scale({1 / k})" aria-hidden="true">
          {#each [0, 1, 2] as i (i)}
            <circle class="ripple" r="14" style="--d:{i * 260}ms" />
          {/each}
          {#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
            <g transform="rotate({i * 30})">
              <line class="ray" x1="0" y1="-20" x2="0" y2="-32" stroke={cols[i % cols.length]} style="--d:{120 + (i % 3) * 60}ms" />
            </g>
          {/each}
        </g>
      {/key}
    {/if}

    {#if trail && trail.length > 1}
      <!-- Connect: the path walked so far -->
      <polyline class="trail" points={pts(routePoints(trail))} stroke-width={8 / k} />
    {/if}
    {#if ends}
      {#each [['from', ends.from], ['to', ends.to]] as [kind, id] (kind)}
        {#if layout[id]}
          <g class="end {kind}" transform="translate({layout[id].x} {layout[id].y}) scale({1 / k})" aria-hidden="true">
            <circle r="13" />
            <text dy="4">{kind === 'from' ? 'A' : 'B'}</text>
          </g>
        {/if}
      {/each}
    {/if}

    {#if you && layout[you]}
      <!-- Connect: you are here -->
      <g data-at={you} transform="translate({layout[you].x} {layout[you].y}) scale({1 / k})" aria-hidden="true">
        <circle class="you-pulse" r="12" />
        <circle class="you" r="8" />
      </g>
    {/if}

    <!-- names sit above every dot, so a later stop never paints over an earlier name -->
    <g class="labels" aria-hidden="true">
      {#each [...shown] as [id, side] (id)}
        <text class="label" class:end={diagram && mark.get(id)?.end} transform="translate({layout[id].x} {layout[id].y}) scale({1 / k})"
          x={LABEL_AT[side].x} dy={LABEL_AT[side].y} text-anchor={LABEL_AT[side].anchor}>{byId[id].name}</text>
      {/each}
    </g>

    <!-- the callout sits above every name -->
    <!-- only for a stop on this map: a mode switch can land while the bubble from another network is up -->
    {#if callout && layout[callout.id]}
      {@const c = layout[callout.id]}
      {@const half = callout.text.length * 3.6 + 10}
      {@const sx = (c.x - view.x) * k}
      <!-- keep the bubble on screen and clear of the zoom buttons (56 px on the right) -->
      {@const shift = Math.min(Math.max(sx - half, 8), size.w - 56 - 2 * half) - (sx - half)}
      {#key callout.n}
        <g class="callout {callout.w}" transform="translate({c.x} {c.y}) scale({1 / k})" aria-hidden="true">
          <rect x={-half + shift} y="-46" width={2 * half} height="26" rx="13" />
          <text x={shift} y="-28" text-anchor="middle">{callout.text}</text>
        </g>
      {/key}
    {/if}
  </svg>
  </div>

  <div class="zoom">
    <button type="button" class="zbtn" aria-label="Zoom in" onclick={() => zoomBy(1.6)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
    </button>
    <button type="button" class="zbtn" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.6)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg>
    </button>
    <button type="button" aria-label="Show whole map" onclick={reset}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" /></svg>
    </button>
  </div>
</div>

<style>
  .wrap { position: relative; width: 100%; height: 100%; }
  .stage { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none; cursor: grab; }
  .stage:active { cursor: grabbing; }
  .map { position: relative; width: 100%; height: 100%; display: block; transform-origin: 0 0; will-change: transform; }
  .tracks line { stroke-linecap: round; transition: opacity 150ms; }
  .water { fill: var(--water); stroke: none; }
  .water.waves { fill: url(#waves); }
  .wave { stroke: var(--water-ink); stroke-width: 1; opacity: 0.22; }
  .landmark { pointer-events: none; text-anchor: middle; }
  .water-label.small { font-size: 10px; }
  .river { fill: none; stroke: var(--river); opacity: 0.7; stroke-linecap: round; stroke-linejoin: round; }
  .area-label { text-anchor: middle; pointer-events: none; }
  .water-label { font-size: 15px; font-style: italic; font-weight: 500; letter-spacing: 0.04em; fill: var(--water-ink); }
  .context polyline { fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: 0.45; }
  .ctx-label { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; fill: var(--muted); pointer-events: none;
               paint-order: stroke; stroke: var(--bg); stroke-width: 3px; }
  .zone-line { fill: none; stroke: var(--muted); opacity: 0.75; }
  .zone-label { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-anchor: middle; fill: var(--muted); pointer-events: none; }
  .ribbon { fill: none; stroke-linecap: butt; stroke-linejoin: round; transition: opacity 150ms; }
  .dim { opacity: 0.15; }
  .faint { opacity: 0.3; }

  .route polyline {
    fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85;
    stroke-dasharray: 1; stroke-dashoffset: 1;
    animation: draw var(--t) linear var(--d) forwards;
  }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  .pulse { fill: none; stroke: var(--fg); opacity: 0; animation: pulse 900ms ease-out var(--d) 2; }
  @keyframes pulse { from { opacity: 0.9; } to { opacity: 0; } }

  .stop { cursor: pointer; outline: none; transition: opacity 150ms; }
  .hit { fill: transparent; }
  .dot { fill: var(--surface); stroke: var(--fg); stroke-width: 1.6; }
  .dot.ring { stroke-width: 2; }
  .dot.hit { fill: var(--hit); stroke: var(--hit); }
  .dot.warmer { fill: var(--warmer); stroke: var(--warmer); }
  .dot.colder { fill: var(--colder); stroke: var(--colder); }
  .dot.first, .dot.same { fill: var(--far); stroke: var(--far); }
  .count { font-size: 11px; font-weight: 700; text-anchor: middle; pointer-events: none; font-variant-numeric: tabular-nums; }
  .count.warmer { fill: var(--on-warmer); }
  .count.colder { fill: var(--on-colder); }
  .count.first, .count.same { fill: var(--on-far); }
  .tick { fill: none; stroke: var(--on-hit); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }

  .capsule { fill: var(--surface); stroke: var(--fg); stroke-width: 1.6; }
  .stn-tick { stroke-width: 2.6; stroke-linecap: butt; }
  .stn-tick.shared { stroke: var(--fg); }
  .label.end { font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
  .ghost { fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: 0.95; }
  .off { opacity: 0.12; }
  .ghost.warmer { stroke: var(--warmer); }
  .ghost.colder { stroke: var(--colder); }
  .ghost.first, .ghost.same { stroke: var(--muted); }
  .got .hit { fill: #e8b931; stroke: #b88a08; stroke-width: 2; }
  .met .hit { fill: none; stroke: var(--accent); stroke-width: 2.5; }
  .you { fill: var(--accent); stroke: var(--surface); stroke-width: 3; }
  .you-pulse { fill: none; stroke: var(--accent); stroke-width: 2; transform-box: fill-box; transform-origin: center;
               animation: you 1600ms ease-out infinite; }
  @keyframes you { from { transform: scale(0.8); opacity: 0.8; } to { transform: scale(2.2); opacity: 0; } }
  .trail { fill: none; stroke: var(--accent); stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; }
  .end circle { stroke-width: 3; }
  .end.from circle { fill: var(--surface); stroke: var(--accent); }
  .end.to circle { fill: var(--hit); stroke: var(--hit); }
  .end text { font-size: 12px; font-weight: 800; text-anchor: middle; pointer-events: none; }
  .end.from text { fill: var(--accent); } .end.to text { fill: var(--on-hit); }
  .ripple { fill: none; stroke: var(--hit); stroke-width: 3; opacity: 0; transform-box: fill-box; transform-origin: center;
            animation: ripple 1500ms cubic-bezier(0.16, 1, 0.3, 1) var(--d) 2; }
  @keyframes ripple { from { transform: scale(0.8); opacity: 0.9; } to { transform: scale(4.2); opacity: 0; } }
  .ray { stroke-width: 3.5; stroke-linecap: round; opacity: 0; animation: burst 900ms cubic-bezier(0.16, 1, 0.3, 1) var(--d) forwards; }
  @keyframes burst { 0% { opacity: 0; transform: translateY(8px); } 25% { opacity: 1; } 100% { opacity: 0; transform: translateY(-14px); } }
  .drawin { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 900ms cubic-bezier(0.16, 1, 0.3, 1) var(--d) forwards; }
  .dot.hit { animation: swell 700ms cubic-bezier(0.16, 1, 0.3, 1); transform-box: fill-box; transform-origin: center; }
  @keyframes swell { 0% { transform: scale(1); } 40% { transform: scale(1.6); } 100% { transform: scale(1); } }
  .pop { animation: pop 380ms cubic-bezier(0.16, 1, 0.3, 1); transform-box: fill-box; transform-origin: center; }
  @keyframes pop { from { transform: scale(0.2); } to { transform: scale(1); } }
  .callout rect { fill: var(--surface); stroke: var(--line); stroke-width: 1; filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.18)); }
  .callout text { font-size: 13px; font-weight: 700; }
  .callout.warmer text { fill: var(--warmer); } .callout.colder text { fill: var(--colder); }
  .callout.hit text { fill: var(--hit); } .callout.first text, .callout.same text { fill: var(--fg); }
  .callout { animation: rise 2200ms ease-out forwards; }
  @keyframes rise { 0% { opacity: 0; } 10% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
  .label {
    font-size: 12px; font-weight: 600; fill: var(--fg);
    paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; pointer-events: none;
  }
  .stop:focus-visible .hit, .selected .hit { stroke: var(--accent); stroke-width: 3; }
  .glow .hit { fill: color-mix(in srgb, var(--accent) 30%, transparent); }

  .zoom { position: absolute; right: 8px; top: 8px; display: grid; gap: 6px; }
  .zoom button { width: 44px; height: 44px; padding: 0; display: grid; place-items: center; }
  /* touch screens pinch to zoom: only the whole-map button stays */
  @media (hover: none) and (pointer: coarse) { .zoom .zbtn { display: none; } }
  @media (max-width: 440px) { .zoom button { width: 40px; height: 40px; } }
  .zoom svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

  @media (prefers-reduced-motion: reduce) {
    .route polyline { animation: none; stroke-dashoffset: 0; }
    .pulse { animation: none; }
    .pop { animation: none; }
    .you-pulse { animation: none; opacity: 0.4; }
    .ripple { animation: none; opacity: 0.35; }
    .ray { animation: none; opacity: 0; }
    .drawin { animation: none; stroke-dashoffset: 0; }
    .dot.hit { animation: none; }
    .callout { animation: none; }
  }
</style>
