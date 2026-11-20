#!/usr/bin/env python3
"""Map layouts: network.json -> schematic.json (the 0/45/90 degree diagram, the default map)
and geo.json (true geography). Hand fixes for diagram key stations go in overrides.json as
{"Station name": {"x", "y"}} in grid units.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "app", "src", "data")
POWER = 0.7
KM_PER_DEG_LAT = 111.32


def project(stations, origin_id, power=POWER):
    """{id: {x, y}} in map units; 1 km from the origin is about 1 unit, north is -y.
    power < 1 pulls distance in (the diagram's starting point); power 1 is true geography."""
    o = next(s for s in stations if s["id"] == origin_id)
    k = math.cos(math.radians(o["lat"]))
    pos = {}
    for s in stations:
        dx = (s["lon"] - o["lon"]) * KM_PER_DEG_LAT * k
        dy = -(s["lat"] - o["lat"]) * KM_PER_DEG_LAT
        r = math.hypot(dx, dy)
        f = r ** (power - 1) if r else 0.0
        pos[s["id"]] = {"x": round(dx * f, 3), "y": round(dy * f, 3)}
    return pos


def mercator(lat, lon):
    """Web Mercator in world pixels at zoom 0 (a 256 px world): the projection map tiles use."""
    x = (lon + 180.0) / 360.0 * 256.0
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * 256.0
    return (x, y)


def geo_layout(stations, origin_id, pairs=None, median_edge=0.5):
    """The real-map layout: Web Mercator around the origin, one uniform scale so the median track
    segment is `median_edge` units (the app's zoom and label thresholds expect that). `world` lets
    the app line the stations up with map tiles: unit = (world px - o) * scale."""
    o = next(s for s in stations if s["id"] == origin_id)
    ox, oy = mercator(o["lat"], o["lon"])
    w = {s["id"]: mercator(s["lat"], s["lon"]) for s in stations}
    scale = 1.0
    if pairs:
        lens = sorted(math.dist(w[a], w[b]) for a, b in pairs)
        scale = median_edge / lens[len(lens) // 2]
    return {
        "stations": {k: {"x": round((x - ox) * scale, 4), "y": round((y - oy) * scale, 4)} for k, (x, y) in w.items()},
        "world": {"scale": scale, "ox": ox, "oy": oy},
    }


def apply_overrides(pos, stations, overrides):
    """Overrides keyed by station name replace the automatic position."""
    by_name = {s["name"]: s["id"] for s in stations}
    out = dict(pos)
    for name, p in overrides.items():
        out[by_name[name]] = {"x": p["x"], "y": p["y"]}  # KeyError on a typo, on purpose
    return out


def load_overrides(path=os.path.join(HERE, "overrides.json")):
    """Hand positions for diagram key stations, {"Station name": {"x", "y"}} in grid units."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


def load_regional_overrides(path=os.path.join(HERE, "overrides.json")):
    with open(path, encoding="utf-8") as f:
        r = json.load(f).get("_regional", {})
    return {k: v for k, v in r.items() if not k.startswith("_")}


def build_regional(net, reg, overrides, reg_overrides, world):
    """V/Line positions on both maps. Diagram: the metro grid, with stations shared with metro
    pinned where the metro diagram has them and V/Line's own junctions and ends hand-placed.
    Real map: metro's Web Mercator transform, so the two networks line up exactly."""
    mpos, _, f = _diagram_grid(net, overrides)
    by_name = {s["name"]: s["id"] for s in reg["stations"]}
    fixed = {sid: (mpos[sid]["x"], mpos[sid]["y"]) for sid in by_name.values() if sid in mpos}
    fixed.update({by_name[n]: (p["x"], p["y"]) for n, p in reg_overrides.items()})
    pairs = sorted({tuple(sorted((e["a"], e["b"]))) for e in reg["edges"]})
    missing = [s for s in key_nodes(pairs) if s not in fixed]
    if missing:
        raise ValueError("V/Line key stations without a position: %s" % missing)
    pos, bends = diagram(fixed, pairs, grid=1.0, fixed=fixed)
    geo = {}
    for s in reg["stations"]:
        x, y = mercator(s["lat"], s["lon"])
        geo[s["id"]] = {"x": round((x - world["ox"]) * world["scale"], 4), "y": round((y - world["oy"]) * world["scale"], 4)}
    return {
        "diagram": {
            "stations": {k: {"x": round(v["x"] * f, 4), "y": round(v["y"] * f, 4)} for k, v in pos.items()},
            "bends": {k: [[round(x * f, 4), round(y * f, 4)] for x, y in pts] for k, pts in bends.items()},
        },
        "geo": geo,
    }


def load_areas(path=os.path.join(HERE, "overrides.json")):
    """Hand-drawn diagram background shapes (grid units), e.g. {"bay": [[x, y], ...]}."""
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        a = json.load(f).get("_areas", {})
    return {k: v for k, v in a.items() if not k.startswith("_")}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--network", default=os.path.join(DATA, "network.json"))
    args = ap.parse_args(argv)
    with open(args.network, encoding="utf-8") as f:
        net = json.load(f)
    diagram_out = build_diagram(net, load_overrides(), load_areas())
    origin = next(s["id"] for s in net["stations"] if s["name"] == "Flinders Street")
    pairs = sorted({tuple(sorted((e["a"], e["b"]))) for e in net["edges"]})
    geo = geo_layout(net["stations"], origin, pairs, DIAGRAM_MEDIAN_EDGE)
    reg_path = os.path.join(DATA, "regional.json")
    if os.path.exists(reg_path):
        with open(reg_path, encoding="utf-8") as f:
            reg = json.load(f)
        reg.update(build_regional(net, reg["network"], load_overrides(), load_regional_overrides(), geo["world"]))
        with open(reg_path, "w", encoding="utf-8") as f:
            json.dump(reg, f, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
        print("wrote %s" % os.path.abspath(reg_path))
    for name, data in (("schematic.json", diagram_out), ("geo.json", geo)):
        path = os.path.join(DATA, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"), sort_keys=True)
        print("wrote %s" % os.path.abspath(path))
    return 0





# ---------------------------------------------------------------- diagram (0/45/90 degree) layout
# The default map: a transit-diagram layout in the station-wall tradition, computed from the
# network's own topology (not traced from any published map). Key stations (junctions and line
# ends) sit on a grid near their geographic place; every stretch between them is drawn as at
# most two straight runs (axis, then 45 degrees), with the bend on a station.

def _adjacency(edges):
    adj = {}
    for a, b in edges:
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    return adj


def key_nodes(edges):
    """Stations that are not simply 'one in, one out': junctions and line ends."""
    return {n for n, nb in _adjacency(edges).items() if len(nb) != 2}


def chains(edges, keys=None):
    """Every stretch of track from one key station to the next, as a list of station ids."""
    adj = _adjacency(edges)
    keys = key_nodes(edges) if keys is None else keys
    seen, out = set(), []
    for k in sorted(keys):
        for first in sorted(adj[k]):
            path, prev, cur = [k], k, first
            while True:
                path.append(cur)
                if cur in keys:
                    break
                prev, cur = cur, next(n for n in adj[cur] if n != prev)
            sig = (frozenset((path[0], path[-1])), tuple(path) if path[0] <= path[-1] else tuple(reversed(path)))
            if sig not in seen:
                seen.add(sig)
                out.append(path)
    return out


def octi_route(a, b):
    """a -> b in at most two runs, each at 0, 45 or 90 degrees: straight first, then diagonal."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    m = min(abs(dx), abs(dy))
    diag = (math.copysign(m, dx), math.copysign(m, dy))
    straight = (dx - diag[0], dy - diag[1])
    if m == 0 or (straight[0] == 0 and straight[1] == 0):
        return [a, b]
    return [a, (a[0] + straight[0], a[1] + straight[1]), b]


def _snap_keys(seeds, keys, grid):
    taken, out = set(), {}
    # inner keys first, so the city keeps the grid points nearest its real place
    for k in sorted(keys, key=lambda k: (math.hypot(*seeds[k]), k)):
        gx, gy = round(seeds[k][0] / grid), round(seeds[k][1] / grid)
        r = 0
        while True:
            ring = [(gx + i, gy + j) for i in range(-r, r + 1) for j in range(-r, r + 1) if max(abs(i), abs(j)) == r]
            free = [p for p in ring if p not in taken]
            if free:
                p = min(free, key=lambda p: (math.dist(p, (seeds[k][0] / grid, seeds[k][1] / grid)), p))
                taken.add(p)
                out[k] = (p[0] * grid, p[1] * grid)
                break
            r += 1
    return out


def _along(p, q, i, n):
    """The i-th of n evenly spaced interior points on p -> q."""
    t = i / (n + 1)
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


def _place_chain(a, b, inner, route):
    """Interior station positions for one stretch along route (2 or 3 points), bend on a station."""
    if len(route) == 2 or not inner:
        return {sid: _along(a, b, i, len(inner)) for i, sid in enumerate(inner, 1)}
    bend = route[1]
    l1, l2 = math.dist(a, bend), math.dist(bend, b)
    k1 = round((len(inner) - 1) * l1 / (l1 + l2))
    first, at_bend, second = inner[:k1], inner[k1], inner[k1 + 1:]
    out = {sid: _along(a, bend, i, len(first)) for i, sid in enumerate(first, 1)}
    out[at_bend] = bend
    out.update({sid: _along(bend, b, i, len(second)) for i, sid in enumerate(second, 1)})
    return out


def _crowding(points, placed, near=1.0):
    """How much new points crowd ones already placed (0 when every gap is at least `near`)."""
    return sum(max(0.0, near - math.dist(p, q)) for p in points for q in placed)


# How far (grid steps) a station may sit from its geographic place before it becomes a key: at
# least DRIFT_BASE, and DRIFT_SHARE of its distance from the city. A diagram may stretch the outer
# suburbs, but not the centre (chosen 2026-11-19 from a sweep: 4 promoted, 0 collisions).
DRIFT_BASE = 3.0
DRIFT_SHARE = 0.5


def diagram(seeds, edges, grid=1.0, fixed=None):
    """Lay out the diagram, then make any station that drifted too far from its real place (see
    DRIFT_BASE, DRIFT_SHARE) a key station of its own, worst first, and lay out again. This keeps
    stretches with far-flung ends (the Metro Tunnel) passing through the places they serve."""
    if fixed:  # hand layout: the named stations are keys, exactly where they were placed
        seeds = {**seeds, **fixed}
        return _diagram_once(seeds, edges, grid, key_nodes(edges) | set(fixed), exact=set(fixed))
    extra = set()
    for _ in range(40):
        pos, bends = _diagram_once(seeds, edges, grid, key_nodes(edges) | extra)
        drift = {k: math.dist((pos[k]["x"], pos[k]["y"]), seeds[k]) / grid
                 - max(DRIFT_BASE, DRIFT_SHARE * math.hypot(*seeds[k]) / grid) for k in pos if k not in extra}
        worst = max(drift, key=lambda k: (drift[k], k))
        if drift[worst] <= 0:
            break
        extra.add(worst)
    return pos, bends


def _crosses(p1, p2, p3, p4):
    d = lambda p, q, r: (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    d1, d2, d3, d4 = d(p3, p4, p1), d(p3, p4, p2), d(p1, p2, p3), d(p1, p2, p4)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0) and min(map(abs, (d1, d2, d3, d4))) > 1e-9


CROSSING_COST = 10.0  # one crossing outweighs any amount of crowding


def _diagram_once(seeds, edges, grid, keys, exact=frozenset()):
    """({id: {x, y}}, {"a|b": [[x, y]]}): key stations on the grid, every stretch at 0/45/90 degrees.
    For each stretch both bend orders (straight then 45, or 45 then straight) are tried and the one
    that crowds stations already placed least is kept. A stretch with no station to put the bend on
    keeps its bend as a point the map draws through. Longest stretches are placed first."""
    kpos = _snap_keys(seeds, keys - set(exact), grid)
    kpos.update({k: tuple(seeds[k]) for k in exact})  # pinned stations keep their exact place
    pos = dict(kpos)
    bends = {}
    drawn = []  # (p, q, station a, station b) of every track segment placed so far
    for c in sorted(chains(edges, keys), key=lambda c: (-len(c), c[0], c[-1])):
        a, b, inner = kpos[c[0]], kpos[c[-1]], c[1:-1]
        options = [octi_route(a, b), list(reversed(octi_route(b, a)))]
        placed = list(pos.values())
        best = None
        for route in options:
            got = _place_chain(a, b, inner, route)
            pts = list(got.values()) + ([route[1]] if len(route) == 3 and not inner else [])
            path = [a] + [got[s] for s in inner] + [b] if inner else route
            ends = set(c)
            new = list(zip(path, path[1:]))
            crossings = sum(1 for p, q in new for (r, t, x, y) in drawn
                            if not ({x, y} & ends) and _crosses(p, q, r, t))
            # a bend with no station on it must not land on (or beside) a station either
            on_station = len(route) == 3 and not inner and any(math.dist(route[1], q) < 0.5 for q in placed)
            cost = _crowding(pts, placed) + CROSSING_COST * (crossings + on_station)
            if best is None or cost < best[0] - 1e-9:
                best = (cost, route, got)
        _, route, got = best
        pos.update(got)
        path = [kpos[c[0]]] + [got[s] for s in inner] + [kpos[c[-1]]] if inner else route
        drawn.extend((p, q, c[0], c[-1]) for p, q in zip(path, path[1:]))
        if len(route) == 3 and not inner:
            lo, hi = sorted((c[0], c[-1]))
            bend = route[1]
            bends[lo + "|" + hi] = [[round(bend[0], 4), round(bend[1], 4)]]
    return {k: {"x": round(x, 4), "y": round(y, 4)} for k, (x, y) in pos.items()}, bends


DIAGRAM_SEED_POWER = 0.45  # stronger than the geographic 0.7: a diagram gives the city centre room
DIAGRAM_SEED_SCALE = 8.0   # spreads the compressed geography so key stations get their own grid points
# (0.45 / 8 chosen 2026-11-19 from a sweep: 0 collisions, 2 crossings, City Loop 17.5% of the map)
DIAGRAM_MEDIAN_EDGE = 0.5  # final scale: the map's zoom and label thresholds expect about this


def _diagram_grid(net, overrides=None):
    """The metro diagram in grid units, before the final rescale, and that rescale factor."""
    stations = net["stations"]
    origin = next(s["id"] for s in stations if s["name"] == "Flinders Street")
    geo = project(stations, origin, power=DIAGRAM_SEED_POWER)
    seeds = {k: (v["x"] * DIAGRAM_SEED_SCALE, v["y"] * DIAGRAM_SEED_SCALE) for k, v in geo.items()}
    fixed = None
    if overrides:  # the hand layout: positions in grid units, keyed by station name
        by_name = {s["name"]: s["id"] for s in stations}
        fixed = {by_name[name]: (p["x"], p["y"]) for name, p in overrides.items()}
    pairs = sorted({tuple(sorted((e["a"], e["b"]))) for e in net["edges"]})
    pos, bends = diagram(seeds, pairs, grid=1.0, fixed=fixed)
    lens = sorted(math.dist((pos[a]["x"], pos[a]["y"]), (pos[b]["x"], pos[b]["y"])) for a, b in pairs)
    return pos, bends, DIAGRAM_MEDIAN_EDGE / lens[len(lens) // 2]


def build_diagram(net, overrides=None, areas=None):
    pos, bends, f = _diagram_grid(net, overrides)
    return {
        "stations": {k: {"x": round(v["x"] * f, 4), "y": round(v["y"] * f, 4)} for k, v in pos.items()},
        "bends": {k: [[round(x * f, 4), round(y * f, 4)] for x, y in pts] for k, pts in bends.items()},
        "areas": {k: [[round(x * f, 4), round(y * f, 4)] for x, y in pts] for k, pts in (areas or {}).items()},
    }


if __name__ == "__main__":
    sys.exit(main())
