# Stops Away

A daily puzzle about Melbourne's train network. Guess the hidden station. Each guess
tells you how many **stops** away it is, how many **changes** you would make, and which
lines you would ride. Plays in the browser and works offline after the first visit.

## Run it

```
cd app
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run check      # type check
npm run build      # static site in app/dist
```

## Data

The network is built from official open data, never typed by hand:

```
python3 tools/build_data.py   # GTFS -> app/src/data/network.json and facts.json
python3 tools/layout.py       # schematic positions -> app/src/data/schematic.json
python3 tools/tests/run_tests.py
```

`build_data.py` reads the GTFS Schedule zip from `tools/.cache/gtfs.zip` (download it from
https://data.ptv.vic.gov.au/downloads/gtfs.zip; it is not committed). The built JSON is
committed, so the app builds without it.

Sources and licences:
- Timetable and stations: GTFS Schedule, Department of Transport and Planning (Victoria), CC BY 4.0.
- Suburbs and council areas: Vicmap Admin, © State of Victoria (Department of Transport and Planning), CC BY 4.0.
- Fare zones: Metro Trains Melbourne station pages, cross-checked against Wikipedia.
- Station facts: one per station, from the linked English Wikipedia article, in our own words.

Stops Away is an independent fan project. It is not affiliated with or endorsed by
Metro Trains Melbourne, Public Transport Victoria or the Victorian Government.

## Publishing

This folder lives inside a private repository. To publish it on its own:

```
git subtree split --prefix=projects/train-game -b stops-away-public   # run in the parent repo
# create an empty public GitHub repository, then:
git push <new-repo-url> stops-away-public:main
```

Then in the new repository: Settings → Pages → Source: GitHub Actions. The workflow in
`.github/workflows/deploy.yml` tests, builds and deploys on every push to `main`.
