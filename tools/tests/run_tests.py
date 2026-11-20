#!/usr/bin/env python3
import io
import json
import math
import os
import sys
import tempfile
import unittest
import zipfile
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
import build_data  # noqa: E402
import layout  # noqa: E402

CACHE_ZIP = os.path.join(TOOLS, ".cache", "gtfs.zip")


def csv_text(header, rows):
    q = lambda v: '"%s"' % v
    lines = [",".join(header)]
    for r in rows:
        lines.append(",".join(q(v) for v in r))
    return "﻿" + "\n".join(lines) + "\n"


def make_zip(path):
    stops = [["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"]]
    for code, name, lat in [("AAA", "Alpha", -37.1), ("BBB", "Bravo", -37.2),
                            ("CCC", "Charlie", -37.3), ("DDD", "Delta", -37.4),
                            ("EEE", "Echo", -37.5)]:
        suffix = " Railway Station" if code == "EEE" else " Station"
        if code == "DDD":
            suffix = " Railway Station (Delta)"
        stops.append(["vic:rail:" + code, name + suffix, str(lat), "145.0", "1", ""])
        stops.append(["p" + code, name + " Station", str(lat), "145.0", "", "vic:rail:" + code])
    routes = [["route_id", "route_short_name", "route_color"],
              ["aus:vic:vic-02-TST:", "Test", "112233"],
              ["aus:vic:vic-02-TST-R:", "Replacement Bus", "FE5000"]]
    trips = [["route_id", "trip_id"],
             ["aus:vic:vic-02-TST:", "all"],
             ["aus:vic:vic-02-TST:", "exp"],
             ["aus:vic:vic-02-TST-R:", "bus"]]
    st = [["trip_id", "stop_id", "stop_sequence", "shape_dist_traveled"]]
    for i, c in enumerate("AAA BBB CCC DDD EEE".split(), 1):
        st.append(["all", "p" + c, str(i), str(i * 1000)])
    for i, c, d in zip((1, 3, 10), ("AAA", "CCC", "EEE"), (1000, 3000, 5000)):  # express skips B and D
        st.append(["exp", "p" + c, str(i), str(d)])
    st.append(["bus", "pAAA", "1", "0"])
    st.append(["bus", "pEEE", "2", "4000"])
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as z:
        z.writestr("stops.txt", csv_text(*[stops[0], stops[1:]]))
        z.writestr("routes.txt", csv_text(routes[0], routes[1:]))
        z.writestr("trips.txt", csv_text(trips[0], trips[1:]))
        z.writestr("stop_times.txt", csv_text(st[0], st[1:]))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("2/google_transit.zip", inner.getvalue())


def make_zip2(path):
    """City loop and cross-line express.

    Line LOP: direct R->F (2 km) and loop R->P->M->F (4.5 km). Both are real track.
    Line ALL stops X, Y, Z; line EXP runs X->Z non-stop over the same 2 km of track.
    """
    stops = [["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"]]
    for code in "R F P M X Y Z".split():
        stops.append(["vic:rail:" + code, code + " Station", "-37.0", "145.0", "1", ""])
        stops.append(["p" + code, code + " Station", "-37.0", "145.0", "", "vic:rail:" + code])
    routes = [["route_id", "route_short_name", "route_color"]] + [
        ["aus:vic:vic-02-%s:" % l, l, "112233"] for l in ("LOP", "ALL", "EXP")]
    runs = {"direct": ("LOP", [("R", 0), ("F", 2000)]),
            "loop": ("LOP", [("R", 0), ("P", 1500), ("M", 2500), ("F", 4500)]),
            "all": ("ALL", [("X", 0), ("Y", 1000), ("Z", 2000)]),
            "exp": ("EXP", [("X", 50), ("Z", 2080)])}
    trips = [["route_id", "trip_id"]] + [["aus:vic:vic-02-%s:" % l, t] for t, (l, _) in runs.items()]
    st = [["trip_id", "stop_id", "stop_sequence", "shape_dist_traveled"]]
    for t, (_, seq) in runs.items():
        for i, (c, d) in enumerate(seq, 1):
            st.append([t, "p" + c, str(i), str(d)])
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as z:
        z.writestr("stops.txt", csv_text(stops[0], stops[1:]))
        z.writestr("routes.txt", csv_text(routes[0], routes[1:]))
        z.writestr("trips.txt", csv_text(trips[0], trips[1:]))
        z.writestr("stop_times.txt", csv_text(st[0], st[1:]))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("2/google_transit.zip", inner.getvalue())


class LoopAndCrossLineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "gtfs.zip")
            make_zip2(p)
            cls.net = build_data.build(p)
        cls.edges = {(e["a"][-1] + e["b"][-1], e["line"]) for e in cls.net["edges"]}

    def test_direct_track_survives_a_longer_loop(self):
        self.assertIn(("FR", "LOP"), self.edges)
        self.assertTrue({("PR", "LOP"), ("MP", "LOP"), ("FM", "LOP")} <= self.edges)

    def test_cross_line_express_rides_the_stopping_track(self):
        self.assertNotIn(("XZ", "EXP"), self.edges)
        self.assertTrue({("XY", "EXP"), ("YZ", "EXP")} <= self.edges)

    def test_station_lines_only_where_trains_stop(self):
        lines = {s["id"][-1]: s["lines"] for s in self.net["stations"]}
        self.assertEqual(lines["Y"], ["ALL"])
        self.assertEqual(lines["X"], ["ALL", "EXP"])


def make_zip3(path):
    """A train that reverses: A->B->C->B (review R1). Plus an all-stops A->B->C."""
    stops = [["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"]]
    for code in "A B C".split():
        stops.append(["vic:rail:" + code, code + " Station", "-37.0", "145.0", "1", ""])
        stops.append(["p" + code, code + " Station", "-37.0", "145.0", "", "vic:rail:" + code])
    routes = [["route_id", "route_short_name", "route_color"], ["aus:vic:vic-02-REV:", "REV", "112233"]]
    runs = {"rev": [("A", 0), ("B", 1000), ("C", 2000), ("B", 3000)], "all": [("A", 0), ("B", 1000), ("C", 2000)]}
    trips = [["route_id", "trip_id"]] + [["aus:vic:vic-02-REV:", t] for t in runs]
    st = [["trip_id", "stop_id", "stop_sequence", "shape_dist_traveled"]]
    for t, seq in runs.items():
        for i, (c, d) in enumerate(seq, 1):
            st.append([t, "p" + c, str(i), str(d)])
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as z:
        z.writestr("stops.txt", csv_text(stops[0], stops[1:]))
        z.writestr("routes.txt", csv_text(routes[0], routes[1:]))
        z.writestr("trips.txt", csv_text(trips[0], trips[1:]))
        z.writestr("stop_times.txt", csv_text(st[0], st[1:]))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("2/google_transit.zip", inner.getvalue())


class ReversingTrainTests(unittest.TestCase):
    def test_a_reversal_adds_no_track(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "gtfs.zip")
            make_zip3(p)
            net = build_data.build(p)
        pairs = {(e["a"][-1], e["b"][-1]) for e in net["edges"]}
        self.assertEqual(pairs, {("A", "B"), ("B", "C")})


class SyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        p = os.path.join(cls.tmp.name, "gtfs.zip")
        make_zip(p)
        cls.net = build_data.build(p)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_lines(self):
        self.assertEqual([l["id"] for l in self.net["lines"]], ["TST"])
        self.assertEqual(self.net["lines"][0]["colour"], "#112233")
        self.assertEqual(self.net["lines"][0]["name"], "Test")

    def test_stations(self):
        self.assertEqual(len(self.net["stations"]), 5)
        s = self.net["stations"][0]
        self.assertEqual(s["name"], "Alpha")
        self.assertEqual(s["aliases"], ["AAA"])
        self.assertEqual(s["lines"], ["TST"])
        self.assertEqual(s["zone"], "")
        names = {x["id"]: x["name"] for x in self.net["stations"]}
        self.assertEqual(names["vic:rail:EEE"], "Echo")
        self.assertEqual(names["vic:rail:DDD"], "Delta")

    def test_edges(self):
        pairs = {(e["a"], e["b"]) for e in self.net["edges"]}
        p = lambda x, y: ("vic:rail:" + x, "vic:rail:" + y)
        self.assertEqual(pairs, {p("AAA", "BBB"), p("BBB", "CCC"), p("CCC", "DDD"), p("DDD", "EEE")})
        self.assertNotIn(p("AAA", "CCC"), pairs)
        self.assertNotIn(p("AAA", "EEE"), pairs)  # replacement bus excluded

    def test_validate(self):
        self.assertIsNone(build_data.validate(self.net))
        self.assertEqual(self.net["meta"]["feed_file"], "2/google_transit.zip")


def stn(sid, name, lat, lon):
    return {"id": sid, "name": name, "lat": lat, "lon": lon}


class ExtraAndFactsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.zip = os.path.join(cls.tmp.name, "gtfs.zip")
        make_zip(cls.zip)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_extra_fills_zone_suburb_lga(self):
        net = build_data.build(self.zip, extra={"vic:rail:AAA": {"zone": "1/2", "suburb": "Alphaville", "lga": "Testshire"}})
        a = [s for s in net["stations"] if s["id"] == "vic:rail:AAA"][0]
        self.assertEqual((a["zone"], a["suburb"], a["lga"]), ("1/2", "Alphaville", "Testshire"))
        b = [s for s in net["stations"] if s["id"] == "vic:rail:BBB"][0]
        self.assertEqual((b["zone"], b["lga"]), ("", ""))

    def test_extra_for_unknown_station_is_an_error(self):
        with self.assertRaises(ValueError):
            build_data.build(self.zip, extra={"vic:rail:NOPE": {"zone": "1", "suburb": "x", "lga": "y"}})

    def test_bad_zone_is_an_error(self):
        with self.assertRaises(ValueError):
            build_data.build(self.zip, extra={"vic:rail:AAA": {"zone": "3", "suburb": "x", "lga": "y"}})

    def test_facts_checked_and_trimmed(self):
        ok = {"A": {"fact": "Opened in 1900.", "source": "https://example.org/a", "checked": "2026-11-19"}}
        self.assertEqual(build_data.checked_facts(ok, {"A"}), {"A": {"fact": "Opened in 1900.", "source": "https://example.org/a"}})
        for bad in ({"Z": ok["A"]},                                              # unknown station
                    {"A": {"fact": "x", "source": "http://insecure"}},           # not https
                    {"A": {"fact": "x" * 161, "source": "https://e.org"}}):      # too long
            with self.assertRaises(ValueError):
                build_data.checked_facts(bad, {"A"})


class LayoutTests(unittest.TestCase):
    # origin O; N 1 km north; FAR 16 km east; SE south-east
    ST = [stn("O", "Origin", -37.8, 145.0), stn("N", "North", -37.791, 145.0),
          stn("FAR", "Far", -37.8, 145.1818), stn("SE", "South East", -37.9, 145.1)]

    def test_origin_at_zero_and_compass_kept(self):
        pos = layout.project(self.ST, "O")
        self.assertEqual(pos["O"], {"x": 0.0, "y": 0.0})
        self.assertAlmostEqual(pos["N"]["x"], 0.0, places=3)
        self.assertLess(pos["N"]["y"], 0)          # north is up (negative y)
        self.assertGreater(pos["SE"]["x"], 0)
        self.assertGreater(pos["SE"]["y"], 0)

    def test_outer_stations_pulled_in(self):
        # 1 km stays ~1 unit; 16 km becomes 16**0.7 ~ 6.96 units, not 16
        pos = layout.project(self.ST, "O")
        self.assertAlmostEqual(-pos["N"]["y"], 1.0, delta=0.02)
        self.assertAlmostEqual(pos["FAR"]["x"], 16 ** 0.7, delta=0.1)

    def test_overrides_by_name_win(self):
        pos = layout.project(self.ST, "O")
        out = layout.apply_overrides(pos, self.ST, {"Far": {"x": 3, "y": -1}})
        self.assertEqual(out["FAR"], {"x": 3, "y": -1})
        self.assertEqual(out["N"], pos["N"])

    def test_web_mercator_matches_the_tile_grid(self):
        # world pixels at zoom 0 (a 256 px world), the projection map tiles use
        self.assertEqual(layout.mercator(0, 0), (128.0, 128.0))
        self.assertAlmostEqual(layout.mercator(0, 180)[0], 256.0)
        x, y = layout.mercator(-37.8183, 144.9671)   # Flinders Street
        self.assertAlmostEqual(x, 231.0878, places=3)
        self.assertGreater(y, 128)                    # southern hemisphere is below the equator

    def test_geo_layout_is_mercator_with_its_transform(self):
        st = self.ST
        g = layout.geo_layout(st, "O")
        self.assertEqual(g["stations"]["O"], {"x": 0.0, "y": 0.0})
        w = g["world"]
        mx, my = layout.mercator(st[2]["lat"], st[2]["lon"])
        self.assertAlmostEqual(g["stations"]["FAR"]["x"], (mx - w["ox"]) * w["scale"], places=3)
        self.assertLess(g["stations"]["N"]["y"], 0)  # north is up

    def test_geographic_projection_keeps_real_distances(self):
        pos = layout.project(self.ST, "O", power=1.0)
        self.assertAlmostEqual(pos["FAR"]["x"], 16.0, delta=0.1)  # 16 km east stays 16 units

    def test_unknown_override_name_is_an_error(self):
        with self.assertRaises(KeyError):
            layout.apply_overrides({}, self.ST, {"Nowhere": {"x": 0, "y": 0}})


class CommittedDataTests(unittest.TestCase):
    """Checks on the committed app data; they need no GTFS download, so they also run in CI."""
    @classmethod
    def setUpClass(cls):
        data = os.path.join(TOOLS, "..", "app", "src", "data")
        with open(os.path.join(data, "network.json"), encoding="utf-8") as f:
            cls.ids = {s["id"] for s in json.load(f)["stations"]}
        cls.data = data

    def test_both_map_layouts_match_the_network(self):
        # a station added to the GTFS without re-running layout.py would crash the map
        with open(os.path.join(self.data, "schematic.json"), encoding="utf-8") as f:
            d = json.load(f)
        self.assertEqual(set(d["stations"]), self.ids)
        self.assertTrue(all(len(k.split("|")) == 2 and set(k.split("|")) <= self.ids for k in d["bends"]))
        with open(os.path.join(self.data, "geo.json"), encoding="utf-8") as f:
            g = json.load(f)
        self.assertEqual(set(g["stations"]), self.ids)
        self.assertEqual(set(g["world"]), {"scale", "ox", "oy"})

    def test_committed_diagram_is_what_layout_py_builds(self):
        with open(os.path.join(self.data, "network.json"), encoding="utf-8") as f:
            net = json.load(f)
        with open(os.path.join(self.data, "schematic.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), layout.build_diagram(net, layout.load_overrides(), layout.load_areas()))

    def test_facts_cover_every_station(self):
        with open(os.path.join(TOOLS, "..", "content", "facts.json"), encoding="utf-8") as f:
            out = build_data.checked_facts(json.load(f)["facts"], self.ids)
        self.assertEqual(set(out), self.ids)

    def test_diagram_bay_is_water_with_no_station_in_it(self):
        with open(os.path.join(self.data, "schematic.json"), encoding="utf-8") as f:
            d = json.load(f)
        bay = d["areas"]["bay"]
        self.assertGreaterEqual(len(bay), 6)
        def inside(x, y, poly):
            hit = False
            for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
                if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                    hit = not hit
            return hit
        wet = [k for k, p in d["stations"].items() if inside(p["x"], p["y"], bay)]
        self.assertEqual(wet, [])
        wp = d["areas"]["westernport"]
        self.assertEqual([k for k, p in d["stations"].items() if inside(p["x"], p["y"], wp)], [])
        self.assertGreaterEqual(len(d["areas"]["yarra"]), 8)  # a river line, not a closed shape
        self.assertIn("yarra_label", d["areas"])

    def test_regional_layouts_join_the_metro_ones(self):
        with open(os.path.join(self.data, "regional.json"), encoding="utf-8") as f:
            reg = json.load(f)
        with open(os.path.join(self.data, "schematic.json"), encoding="utf-8") as f:
            sch = json.load(f)
        with open(os.path.join(self.data, "geo.json"), encoding="utf-8") as f:
            geo = json.load(f)
        ids = {s["id"] for s in reg["network"]["stations"]}
        self.assertEqual(set(reg["diagram"]["stations"]), ids)
        self.assertEqual(set(reg["geo"]), ids)
        shared = ids & self.ids
        self.assertGreaterEqual(len(shared), 15)
        for sid in shared:  # a shared station sits on the same spot in both, on both maps
            self.assertEqual(reg["diagram"]["stations"][sid], sch["stations"][sid], sid)
            self.assertEqual(reg["geo"][sid], geo["stations"][sid], sid)

    def test_regional_diagram_is_0_45_90_and_dry(self):
        with open(os.path.join(self.data, "regional.json"), encoding="utf-8") as f:
            reg = json.load(f)
        P, B = reg["diagram"]["stations"], reg["diagram"]["bends"]
        pairs = sorted({tuple(sorted((e["a"], e["b"]))) for e in reg["network"]["edges"]})
        def okay(p, q):
            dx, dy = abs(q[0] - p[0]), abs(q[1] - p[1])
            return dx < 1e-3 or dy < 1e-3 or abs(dx - dy) < 1e-3
        bad = []
        for a, b in pairs:
            pts = [(P[a]["x"], P[a]["y"])] + [tuple(x) for x in B.get(a + "|" + b, [])] + [(P[b]["x"], P[b]["y"])]
            if not all(okay(p, q) for p, q in zip(pts, pts[1:])):
                bad.append((a, b))
        self.assertEqual(bad, [])

    def test_app_facts_match_the_content_file(self):
        # app/src/data/facts.json is generated; it must not drift from content/facts.json
        with open(os.path.join(TOOLS, "..", "content", "facts.json"), encoding="utf-8") as f:
            want = build_data.checked_facts(json.load(f)["facts"], self.ids)
        with open(os.path.join(self.data, "facts.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), want)


def octilinear(p, q, tol=1e-6):
    dx, dy = q[0] - p[0], q[1] - p[1]
    return abs(dx) < tol or abs(dy) < tol or abs(abs(dx) - abs(dy)) < tol


# Y-shaped toy network: J is a junction; A, B, C are line ends.
#   A - a1 - a2 - J - c1 - C       and   J - b1 - B
Y_EDGES = [("A", "a1"), ("a1", "a2"), ("a2", "J"), ("J", "c1"), ("c1", "C"), ("J", "b1"), ("b1", "B")]


class HandLayoutTests(unittest.TestCase):
    def test_a_named_station_becomes_a_fixed_key_where_it_was_placed(self):
        seeds = {"A": (0, 0), "a1": (1, 0), "a2": (2, 0), "J": (3, 0), "c1": (4, 0), "C": (5, 0), "b1": (3, 1), "B": (3, 2)}
        pos, _ = layout.diagram(seeds, Y_EDGES, grid=1.0, fixed={"a1": (1, -2)})
        self.assertEqual((pos["a1"]["x"], pos["a1"]["y"]), (1, -2))
        self.assertEqual((pos["A"]["x"], pos["A"]["y"]), (0, 0))  # its neighbours still follow the seeds


class DiagramTests(unittest.TestCase):
    def test_key_nodes_are_junctions_and_line_ends(self):
        self.assertEqual(layout.key_nodes(Y_EDGES), {"A", "B", "C", "J"})

    def test_chains_run_key_to_key_in_order(self):
        got = sorted(tuple(c) if c[0] < c[-1] else tuple(reversed(c)) for c in layout.chains(Y_EDGES))
        self.assertEqual(got, [("A", "a1", "a2", "J"), ("B", "b1", "J"), ("C", "c1", "J")])

    def test_octi_route_uses_only_0_45_90_degrees(self):
        for b in [(3, 1), (1, 3), (-2, 5), (4, 0), (-3, -3)]:
            pts = layout.octi_route((0, 0), b)
            self.assertEqual(pts[0], (0, 0))
            self.assertEqual(pts[-1], b)
            self.assertTrue(all(octilinear(p, q) for p, q in zip(pts, pts[1:])), (b, pts))
            self.assertLessEqual(len(pts), 3)

    def test_diagram_draws_every_toy_edge_at_0_45_90(self):
        seeds = {"A": (0, 0), "a1": (1, 0.3), "a2": (2, 0.2), "J": (3, 1), "c1": (4, 1.5), "C": (5, 3),
                 "b1": (3.5, -1), "B": (4, -3)}
        pos, _ = layout.diagram(seeds, Y_EDGES, grid=1.0)
        bad = [(a, b) for a, b in Y_EDGES if not octilinear((pos[a]["x"], pos[a]["y"]), (pos[b]["x"], pos[b]["y"]))]
        self.assertEqual(bad, [])
        for a, b in Y_EDGES:
            self.assertGreater(math.dist((pos[a]["x"], pos[a]["y"]), (pos[b]["x"], pos[b]["y"])), 0.05)


class RealDiagramTests(unittest.TestCase):
    """The built diagram for the real network (committed data; no GTFS download needed)."""
    @classmethod
    def setUpClass(cls):
        data = os.path.join(TOOLS, "..", "app", "src", "data")
        with open(os.path.join(data, "network.json"), encoding="utf-8") as f:
            cls.net = json.load(f)
        cls.pairs = sorted({tuple(sorted((e["a"], e["b"]))) for e in cls.net["edges"]})
        d = layout.build_diagram(cls.net, layout.load_overrides())  # the hand-designed layout that ships
        cls.pos, cls.bends = d["stations"], d["bends"]

    def segments(self, a, b):
        pts = [(self.pos[a]["x"], self.pos[a]["y"])] + [tuple(p) for p in self.bends.get(a + "|" + b, [])] + [(self.pos[b]["x"], self.pos[b]["y"])]
        return list(zip(pts, pts[1:]))

    def test_every_track_segment_is_0_45_90(self):
        bad = [(a, b) for a, b in self.pairs if not all(octilinear(p, q, 1e-3) for p, q in self.segments(a, b))]
        self.assertEqual(bad, [])

    def test_a_bend_never_sits_on_a_station(self):
        P = [(v["x"], v["y"]) for v in self.pos.values()]
        on = [k for k, pts in self.bends.items() for b in pts if any(math.dist(b, p) < 0.15 for p in P)]
        self.assertEqual(on, [])

    def test_no_two_stations_collide(self):
        ids = sorted(self.pos)
        P = {i: (self.pos[i]["x"], self.pos[i]["y"]) for i in ids}
        name = {s["id"]: s["name"] for s in self.net["stations"]}
        close = [(name[a], name[b]) for i, a in enumerate(ids) for b in ids[i + 1:] if math.dist(P[a], P[b]) < 0.2]
        self.assertEqual(close, [])

    def test_the_city_gets_room(self):
        # a diagram enlarges the centre: the City Loop should span at least 15% of the whole map
        P = {s["name"]: (self.pos[s["id"]]["x"], self.pos[s["id"]]["y"]) for s in self.net["stations"]}
        loop = [P[n] for n in ("Flinders Street", "Southern Cross", "Flagstaff", "Melbourne Central", "Parliament")]
        span = max(math.dist(p, q) for i, p in enumerate(loop) for q in loop[i + 1:])
        xs, ys = [p[0] for p in P.values()], [p[1] for p in P.values()]
        self.assertGreaterEqual(span / max(max(xs) - min(xs), max(ys) - min(ys)), 0.15)

    def test_metro_tunnel_runs_under_the_city(self):
        # State Library and Town Hall are CBD stations: they belong inside the City Loop's box
        P = {s["name"]: (self.pos[s["id"]]["x"], self.pos[s["id"]]["y"]) for s in self.net["stations"]}
        loop = [P[n] for n in ("Flinders Street", "Southern Cross", "Flagstaff", "Melbourne Central", "Parliament")]
        x0, x1 = min(p[0] for p in loop) - 0.5, max(p[0] for p in loop) + 0.5
        y0, y1 = min(p[1] for p in loop) - 0.5, max(p[1] for p in loop) + 0.5
        for n in ("State Library", "Town Hall"):
            self.assertTrue(x0 <= P[n][0] <= x1 and y0 <= P[n][1] <= y1, "%s at %s, loop box %s" % (n, P[n], (x0, y0, x1, y1)))

    # Real grade-separated crossings a diagram may show: the Metro Tunnel passes under other lines,
    # and Flinders Street / Parliament each link to both Jolimont and Richmond (the tracks cross on
    # different levels there; four such links cannot be drawn flat without one crossing).
    TUNNEL = {"Arden", "Parkville", "State Library", "Town Hall", "Anzac"}
    BURROW = {frozenset({"Flinders Street", "Jolimont-MCG"}), frozenset({"Parliament", "Richmond"})}

    def test_only_real_crossings(self):
        name = {s["id"]: s["name"] for s in self.net["stations"]}
        segs = [(p, q, a, b) for a, b in self.pairs for p, q in self.segments(a, b)]
        bad = []
        for i, (p1, p2, a1, b1) in enumerate(segs):
            for p3, p4, a2, b2 in segs[i + 1:]:
                if {a1, b1} & {a2, b2} or not layout._crosses(p1, p2, p3, p4):
                    continue
                e1, e2 = {name[a1], name[b1]}, {name[a2], name[b2]}
                if e1 & self.TUNNEL or e2 & self.TUNNEL or {frozenset(e1), frozenset(e2)} == self.BURROW:
                    continue
                bad.append((sorted(e1), sorted(e2)))
        self.assertEqual(bad, [])

    def test_same_scale_as_the_old_schematic(self):
        # the map's label and zoom thresholds were tuned for a median track segment of about 0.5 units
        import statistics
        med = statistics.median(math.dist((self.pos[a]["x"], self.pos[a]["y"]), (self.pos[b]["x"], self.pos[b]["y"])) for a, b in self.pairs)
        self.assertAlmostEqual(med, 0.5, delta=0.15)


@unittest.skipUnless(os.path.exists(CACHE_ZIP), "cache zip absent")
class RealDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.net = build_data.build(CACHE_ZIP)
        cls.name = {s["id"]: s["name"] for s in cls.net["stations"]}
        cls.edges = {(frozenset((cls.name[e["a"]], cls.name[e["b"]])), e["line"])
                     for e in cls.net["edges"]}
        cls.line_id = {l["name"]: l["id"] for l in cls.net["lines"]}

    def has(self, a, b, line):
        return (frozenset((a, b)), self.line_id[line]) in self.edges

    def test_counts(self):
        self.assertEqual(len(self.net["stations"]), 226)
        self.assertEqual(len(self.net["lines"]), 17)

    def test_known_edges(self):
        self.assertTrue(self.has("Holmesglen", "Jordanville", "Glen Waverley"))
        self.assertTrue(self.has("Richmond", "South Yarra", "Frankston"))
        self.assertTrue(self.has("Ringwood", "Heatherdale", "Lilydale"))

    def test_express_skip(self):
        self.assertFalse(self.has("Caulfield", "Richmond", "Frankston"))

    def test_direct_city_track_survives_the_loop(self):
        for line in ("Frankston", "Lilydale", "Belgrave", "Glen Waverley", "Alamein"):
            self.assertTrue(self.has("Richmond", "Flinders Street", line), line)

    def test_direct_track_beside_the_altona_loop(self):
        # Werribee trains run Newport-Laverton direct; the Altona Loop is other track only ~11% longer
        self.assertTrue(self.has("Laverton", "Newport", "Werribee"))

    def test_cross_line_express_rides_the_stopping_track(self):
        # Pakenham expresses pass Armadale/Toorak/Hawksburn (Frankston stops): no Malvern-South Yarra
        # shortcut; the express is drawn over those platforms instead (same four-track corridor).
        self.assertFalse(self.has("Malvern", "South Yarra", "Pakenham"))
        self.assertTrue(self.has("Malvern", "Armadale", "Pakenham"))

    def test_each_line_is_one_piece(self):
        for l in self.net["lines"]:
            adj = {}
            for e in self.net["edges"]:
                if e["line"] == l["id"]:
                    adj.setdefault(e["a"], set()).add(e["b"])
                    adj.setdefault(e["b"], set()).add(e["a"])
            start = next(iter(adj))
            seen, q = {start}, deque([start])
            while q:
                for n in adj[q.popleft()]:
                    if n not in seen:
                        seen.add(n)
                        q.append(n)
            self.assertEqual(set(adj) - seen, set(), l["name"])

    def test_real_extras_cover_every_station(self):
        net = build_data.build(CACHE_ZIP, extra=build_data.load_extra())
        bad = [s["name"] for s in net["stations"] if s["zone"] not in ("1", "2", "1/2") or not s["lga"]]
        self.assertEqual(bad, [])

    def test_metro_tunnel_through_running(self):
        # GTFS ends every Sunbury trip at Town Hall and starts every Cranbourne/Pakenham trip there;
        # 99.6% of arrivals are met by a departure of the other line within 5 min (measured 2026-11-19)
        thl = [s["id"] for s in self.net["stations"] if s["name"] == "Town Hall"][0]
        got = {(t["a"], t["b"], t["at"]) for t in self.net["through"]}
        self.assertEqual(got, {("CBE", "SUY", thl), ("PKM", "SUY", thl)})

    def test_regional_vline_network(self):
        r = build_data.build(CACHE_ZIP, feed=build_data.REGIONAL_FEED, prefix=build_data.REGIONAL_PREFIX, names="long")
        names = {l["name"] for l in r["lines"]}
        self.assertEqual(len(r["lines"]), 13)
        self.assertTrue({"Albury", "Shepparton", "Swan Hill", "Warrnambool", "Bairnsdale", "Geelong"} <= names, names)
        self.assertEqual({l["colour"] for l in r["lines"]}, {"#8F1A95"})
        self.assertGreaterEqual(len(r["stations"]), 100)
        st = {s["name"] for s in r["stations"]}
        self.assertTrue({"Southern Cross", "Ballarat", "Bendigo", "Geelong", "Traralgon"} <= st)
        self.assertEqual([s["name"] for s in r["stations"] if not s["lines"]], [])
        # one network: every station reachable from Southern Cross
        adj = {}
        for e in r["edges"]:
            adj.setdefault(e["a"], set()).add(e["b"]); adj.setdefault(e["b"], set()).add(e["a"])
        start = [s["id"] for s in r["stations"] if s["name"] == "Southern Cross"][0]
        seen, q = {start}, deque([start])
        while q:
            for n in adj[q.popleft()]:
                if n not in seen:
                    seen.add(n); q.append(n)
        self.assertEqual({s["id"] for s in r["stations"]} - seen, set())

    def test_connected(self):
        adj = {}
        for e in self.net["edges"]:
            adj.setdefault(e["a"], set()).add(e["b"])
            adj.setdefault(e["b"], set()).add(e["a"])
        served = {s["id"] for s in self.net["stations"] if s["lines"]}
        start = [s["id"] for s in self.net["stations"] if s["name"] == "Flinders Street"][0]
        seen = {start}
        q = deque([start])
        while q:
            for n in adj.get(q.popleft(), ()):
                if n not in seen:
                    seen.add(n)
                    q.append(n)
        self.assertEqual(served - seen, set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
