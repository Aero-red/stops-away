#!/usr/bin/env python3
"""Build the game's network.json from Victoria's public GTFS zip (metro trains)."""
import argparse
import csv
import io
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_INPUT = os.path.join(HERE, ".cache", "gtfs.zip")
DEFAULT_OUTPUT = os.path.join(HERE, "..", "app", "src", "data", "network.json")
EXTRA_FILE = os.path.join(HERE, "station_extra.json")
FACTS_IN = os.path.join(HERE, "..", "content", "facts.json")
FACTS_OUT = os.path.join(HERE, "..", "app", "src", "data", "facts.json")
ZONES = ("1", "2", "1/2")
# One train, two line names. GTFS splits the Metro Tunnel at Town Hall: every Sunbury trip
# ends there and every Cranbourne/Pakenham trip starts there, and 99.6% of arrivals are met
# by the other line within 5 minutes (measured 2026-11-19, LOTUS-037). Listed by hand: a timing
# scan also "finds" timed connections (Stony Point at Frankston) and Flinders Street noise.
THROUGH = [("CBE", "SUY", "vic:rail:THL"), ("PKM", "SUY", "vic:rail:THL")]
FACT_MAX = 160
FEED_FILE = "2/google_transit.zip"
ROUTE_PREFIX = "aus:vic:vic-02-"
REGIONAL_FEED = "1/google_transit.zip"   # V/Line regional trains (the Regional practice mode)
REGIONAL_PREFIX = "aus:vic:vic-01-"
REGIONAL_OUTPUT = os.path.join(HERE, "..", "app", "src", "data", "regional.json")
SAME_TRACK = 0.05  # same track if within 5%: real expresses measure <=3%, the Altona Loop 11%
SOURCE = ("GTFS Schedule and Vicmap Admin, Department of Transport and Planning (Victoria), CC BY 4.0; "
          "fare zones from Metro Trains station pages")


def clean_name(name):
    # Real feed uses "X Railway Station" (once "X Railway Station (X)"); fall back to " Station".
    name = name.strip()  # the regional feed has "Geelong Railway Station " (trailing space)
    m = re.search(r"\s+Railway Station(\s*\(.*\))?$", name)
    if m:
        return name[: m.start()]
    if name.endswith(" Station"):
        return name[: -len(" Station")]
    return name


def read_csv(zf, name):
    with zf.open(name) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        for row in csv.DictReader(text):
            yield row


def load_extra(path=EXTRA_FILE):
    """Zone, suburb and LGA per station id (sources recorded in the file's _about)."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)["stations"]


def checked_facts(facts, station_ids):
    """{id: {fact, source}} for the app; ValueError on an unknown id, non-https source or long fact."""
    out = {}
    for sid, v in facts.items():
        if sid not in station_ids:
            raise ValueError("fact for unknown station %s" % sid)
        if not str(v.get("source", "")).startswith("https://"):
            raise ValueError("fact for %s has no https source" % sid)
        if not v.get("fact") or len(v["fact"]) > FACT_MAX:
            raise ValueError("fact for %s is empty or over %d characters" % (sid, FACT_MAX))
        out[sid] = {"fact": v["fact"], "source": v["source"]}
    return out


def build(input_path, extra=None, feed=FEED_FILE, prefix=ROUTE_PREFIX, names="short"):
    """names="long": name each line by its far end, from route_long_name ("Albury - Melbourne via
    Seymour" -> "Albury"); V/Line's short names repeat across routes."""
    with zipfile.ZipFile(input_path) as outer:
        data = outer.read(feed)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        # Stations and platform -> parent mapping
        stations = {}
        parent = {}
        for r in read_csv(zf, "stops.txt"):
            if r["location_type"] == "1":
                sid = r["stop_id"]
                name = r["stop_name"]
                name = clean_name(name)
                stations[sid] = {
                    "id": sid,
                    "name": name,
                    "aliases": [sid.rsplit(":", 1)[-1]],
                    "lat": float(r["stop_lat"]),
                    "lon": float(r["stop_lon"]),
                    "zone": "",
                    "suburb": "",
                    "lga": "",
                    "lines": [],
                }
            elif r["location_type"] in ("", "0"):
                if r.get("parent_station"):
                    parent[r["stop_id"]] = r["parent_station"]

        # Lines
        lines = {}
        route_line = {}
        for r in read_csv(zf, "routes.txt"):
            rid = r["route_id"]
            if not rid.startswith(prefix) or rid.endswith("-R:"):
                continue
            lid = rid[len(prefix):].split(":", 1)[0]
            name = r["route_long_name"].split(" - ")[0].strip() if names == "long" else r["route_short_name"]
            lines[lid] = {"id": lid, "name": name,
                          "colour": "#" + r["route_color"]}
            route_line[rid] = lid

        trip_line = {}
        for r in read_csv(zf, "trips.txt"):
            if r["route_id"] in route_line:
                trip_line[r["trip_id"]] = route_line[r["route_id"]]

        trip_stops = {}
        for r in read_csv(zf, "stop_times.txt"):
            tid = r["trip_id"]
            if tid in trip_line:
                trip_stops.setdefault(tid, []).append(
                    (int(r["stop_sequence"]), r["stop_id"], float(r["shape_dist_traveled"])))

    # One run per distinct (line, station sequence): [(station, track metres), ...]
    runs = {}
    for tid, items in trip_stops.items():
        items.sort()
        seq = []
        for _, stop, dist in items:
            st = parent.get(stop, stop)
            if st not in stations:
                continue
            if not seq or seq[-1][0] != st:
                seq.append((st, dist))
        runs.setdefault((trip_line[tid], tuple(s for s, _ in seq)), seq)

    # Every stretch a train runs past intermediate stations, on any line, by
    # station pair: (track metres, intermediates in a<b order).
    covers = {}
    for seq in runs.values():
        for i in range(len(seq)):
            for j in range(i + 2, len(seq)):
                (a, da), (b, db) = seq[i], seq[j]
                if a == b:
                    continue
                mids = [s for s, _ in seq[i + 1:j]]
                if a > b:
                    a, b, mids = b, a, mids[::-1]
                covers.setdefault((a, b), []).append((abs(db - da), mids))

    def hops(a, b, d):
        """A non-stop hop over the same track as a stopping run becomes that
        run's hops (an express skip). A hop much shorter than any longer run
        (the direct track beside the City Loop) stays as it is."""
        lo, hi = (a, b) if a < b else (b, a)
        same_track = [m for dc, m in covers.get((lo, hi), ()) if abs(dc - d) <= SAME_TRACK * max(d, 1.0)]
        if not same_track:
            return [(lo, hi)]
        path = [lo] + max(same_track, key=len) + [hi]
        return list(zip(path, path[1:]))

    edge_set = set()
    served = {}
    for (lid, _), seq in runs.items():
        for st, _ in seq:
            served.setdefault(st, set()).add(lid)
        for (a, da), (b, db) in zip(seq, seq[1:]):
            for x, y in hops(a, b, abs(db - da)):
                edge_set.add((x, y, lid) if x < y else (y, x, lid))
    edges = [{"a": a, "b": b, "line": l} for a, b, l in edge_set]

    for sid, ls in served.items():
        stations[sid]["lines"] = sorted(ls)

    for sid, x in (extra or {}).items():
        if sid not in stations:
            raise ValueError("extra data for unknown station %s" % sid)
        if x["zone"] not in ZONES:
            raise ValueError("station %s has zone %r, expected one of %s" % (sid, x["zone"], ZONES))
        stations[sid].update(zone=x["zone"], suburb=x["suburb"], lga=x["lga"])

    edges.sort(key=lambda e: (e["line"], e["a"], e["b"]))
    through = []
    for a, b, at in THROUGH:
        if a not in lines or b not in lines or at not in stations:
            continue  # synthetic feeds and future networks without these lines
        if not {a, b} <= set(stations[at]["lines"]):
            raise ValueError("through-running %s/%s at %s: both lines must serve it" % (a, b, at))
        through.append({"a": a, "b": b, "at": at})
    return {
        "stations": [stations[k] for k in sorted(stations)],
        "lines": [lines[k] for k in sorted(lines)],
        "edges": edges,
        "through": through,
        "meta": {"source": SOURCE, "feed_file": feed,
                 "built_from": os.path.basename(input_path)},
    }


def validate(net):
    ids = {s["id"] for s in net["stations"]}
    for e in net["edges"]:
        for end in (e["a"], e["b"]):
            if end not in ids:
                return "edge endpoint %s is not a known station" % end
    with_edges = {e["line"] for e in net["edges"]}
    for l in net["lines"]:
        if l["id"] not in with_edges:
            return "line %s has no edges" % l["id"]
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", default=DEFAULT_INPUT)
    ap.add_argument("--output", default=DEFAULT_OUTPUT)
    args = ap.parse_args(argv)
    net = build(args.input, extra=load_extra())
    err = validate(net)
    if err:
        print("VALIDATION FAILED: " + err, file=sys.stderr)
        return 1
    out = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(net, f, separators=(",", ":"), ensure_ascii=False)
    with open(FACTS_IN, encoding="utf-8") as f:
        facts = checked_facts(json.load(f)["facts"], {s["id"] for s in net["stations"]})
    with open(FACTS_OUT, "w", encoding="utf-8") as f:
        json.dump(facts, f, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
    orphans = [s["name"] for s in net["stations"] if not s["lines"]]
    print("stations: %d  lines: %d  edges: %d" % (
        len(net["stations"]), len(net["lines"]), len(net["edges"])))
    print("orphans (%d): %s" % (len(orphans), ", ".join(orphans) or "none"))
    print("wrote %s (%d bytes)" % (out, os.path.getsize(out)))
    print("wrote %s (%d facts)" % (os.path.abspath(FACTS_OUT), len(facts)))
    # V/Line, for the Regional practice mode; layout.py adds its map positions to this file
    reg = build(args.input, feed=REGIONAL_FEED, prefix=REGIONAL_PREFIX, names="long")
    with open(REGIONAL_OUTPUT, "w", encoding="utf-8") as f:
        json.dump({"network": reg}, f, separators=(",", ":"), ensure_ascii=False)
    print("wrote %s (%d V/Line stations, %d lines)" % (os.path.abspath(REGIONAL_OUTPUT), len(reg["stations"]), len(reg["lines"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
