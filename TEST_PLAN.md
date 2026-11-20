# TEST PLAN — Stops Away v1 playtest (LOTUS-037, H3)

> Written by Hermes (H3, 2026-11-19T00:40Z) and landed by Claude Code, word for word except for heading levels. Owner: Hermes.
>
> **Changed since Hermes wrote this (Claude Code, 2026-11-19):**
> - The public name is **Stops Away**, so A1 expects the header "Stops Away" and "Chuggington" no longer appears (limitation 5 is settled).
> - **Metro Tunnel through-running is modelled** (limitation 1 is fixed). Sunbury ↔ Cranbourne/Pakenham at Town Hall now counts **0 changes**, so in D3 expect "0 changes", with the lines shown as Sunbury then Cranbourne/Pakenham.


Build under test: commit `a7299f5` (plus any later uncommitted changes — record
`git rev-parse --short HEAD` and `git status --short` at the start of the run).
One person, a phone and a desktop, about 20 minutes. Written by Hermes
(deepseek-flash) 2026-11-19; I did not run it — no browser in my sandbox, so every
expected value below is read from the code at that commit, not from a play session.

## How to run it

1. `cd projects/train-game/app && npm run dev -- --host` — the LAN URL it prints
   (`http://192.168.x.x:5173/`) is what the phone uses; the phone must be on the same
   Wi-Fi.
2. Desktop: Chrome or Safari, a fresh profile or "Clear site data" first.
3. Record, per case, Pass or Fail and one line of notes. Screenshot every Fail and
   paste any console error.
4. The order below is the fastest path. If you only have 20 minutes, run the cases
   marked ★ and leave the rest (they need a faked clock or a production build).
5. Offline (I) is the one case that cannot pass on `npm run dev`: the service worker
   registers only in a production build (`src/main.ts`), so those two cases run
   against `npm run build && npm run preview -- --host`.

## Reference values (checked against the data at `a7299f5`)

| Thing | Value |
|---|---|
| Game number in the header | days since 2026-01-01 + 1; on 2026-11-19 it is **#323** |
| Guesses | 8 maximum; hint budget 100 points; 10 points per unused guess |
| Hint costs | Fare zone 10, A line 20, Council 25, First letter 30, Area 40 (double in Hard) |
| Zone 1 / 1/2 / 2 examples | Flinders Street 1, Albion 1/2, Frankston 2 |
| Council-area examples | Frankston → Frankston, Albion → Brimbank, Jordanville → Monash |
| Worked route: Flinders Street → Brighton Beach | 11 stops, 0 changes, Sandringham |
| Worked route: Jordanville → Ringwood | 24 stops, 1 change, Glen Waverley then Belgrave |
| Worked route: State Library → Anzac | 2 stops, 1 change, Sunbury then Cranbourne |

## A. Daily and Practice

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| A1 ★ | Clear site data, load the URL. | Header "Chuggington", the game number (#323 today), 🔥 0, Daily highlighted. The whole network draws. Panel: "Guesses 0/8", the guess box, "Hints · 100 pts left". | | |
| A2 ★ | Click Practice. | Header shows "Practice"; the map and history reset; a random target; the streak does not change; a reload returns to Daily. | | |
| A3 ★ | Click Daily again. | Today's game comes back with its guesses, hints and score intact (not a fresh start). | | |

## B. Typing

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| B1 ★ | Type "flind", then Enter. | "Flinders Street" is the first suggestion and Enter guesses it; the history row reads "Flinders Street <n> stops · <m> changes" with line chips. | | |
| B2 ★ | Type "FSS". | Flinders Street is offered (station codes work). Enter guesses it. | | |
| B3 ★ | Type "jolimont". | "Jolimont-MCG" is offered (the GTFS name, not the old "Jolimont"). | | |
| B4 ★ | Type "sydney" (no such station). | No list appears; Enter does nothing; no console error. | | |
| B5 ★ | Type the name of a station you have already guessed. | It is not offered (guessed stations are filtered out). | | |
| B6 ★ | Type "st" or "station" alone. | Either no list or only plausible matches; nothing crashes. Typing "glen huntly station" still offers Glen Huntly. | | |

## C. Tapping a stop and the stop card

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| C1 ★ | Tap any stop. | Card with the station name, its line chips, "Zone N" and a "Guess this" button. | | |
| C2 ★ | Tap "Guess this". | The card closes; the guess lands in the history; the stop becomes a filled dot with the stop count inside it. | | |
| C3 ★ | Tap a stop, then tap empty map; then tap a stop and the × ; then a stop and Escape. | The card closes each time and no guess is made. | | |
| C4 ★ | Tap Albion, then Frankston, then Flinders Street. | Zone 1/2, Zone 2, Zone 1 respectively. | | |

## D. Feedback numbers against a real trip

Read today's target on the desktop: devtools → Application → Local Storage →
`chug:daily:<N>` → `targetId`; the last three letters are the station code. You then
know the pair before you guess, so you can check the same trip on the PTV journey
planner (`ptv.vic.gov.au` → Plan) straight away.

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| D1 ★ | Guess a station on the same line as the target. | "0 changes", the line named once. Compare with the planner: one train, no change. | | |
| D2 ★ | Guess a station two lines away. | "1 change"; the planner's itinerary changes at the station the app pulses. | | |
| D3 | Guess a station across the Metro Tunnel (target Anzac/Town Hall/State Library/Parkville/Arden, guess on the other side). | App: "1 change" at Town Hall, "Sunbury" then "Cranbourne"/"Pakenham". Write down what the planner says — see limitations. | | |
| D4 | If a target is Brighton Beach, Ringwood or Anzac, reproduce the worked pair from the table above. | The numbers in the table. | | |

## E. Hints

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| E1 ★ | Open "Hints · 100 pts left". | Five buttons: Fare zone −10, A line −20, Council −25, First letter −30, Area −40. | | |
| E2 ★ | Buy each of the five, reading the result after each. | Fare zone: "Zone N" (or "Zone 1/2 (the overlap)"). A line: "One line through it: <line>". Council: "Council area: <LGA>". First letter: `Starts with "F"`. Area: "<Compass> of the city, <band>". The button then shows "bought" and the counter drops by the cost. | | |
| E3 ★ | Keep buying until fewer than 40 points are left. | The unaffordable buttons are disabled (Area first). | | |
| E4 ★ | Finish or lose a game. | The hint shop disappears; no hint can be bought afterwards. | | |
| E5 | Hard mode on, buy Fare zone. | −20 and 80 left (double). Compare with 90 left in normal mode. | | |
| E6 ★ | Try to buy the same hint twice. | Impossible: the button says "bought" and is disabled. | | |

## F. Hard mode

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| F1 ★ | On a fresh daily, tick Hard before any guess. | Tracks turn grey, labels disappear, the box stays ticked. | | |
| F2 ★ | Make one guess, then look at the Hard checkbox. | Disabled, tooltip "Choose before your first guess". | | |
| F3 | Buy a hint in Hard. | Costs are doubled (see E5) and the eventual share card ends "· Hard". | | |
| F4 ★ | In Hard, tap an unguessed stop. | Card says "This stop", no line chips, no name. | | |

## G. Persistence

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| G1 ★ | Make two guesses, add one hint, reload the page. | Same target, same two guesses, the hint still bought, points still spent, Hard setting kept. | | |
| G2 | Finish today's game; reload; then move the clock to the next day and reload. | Stats "Played 1 · Won 1 · Streak 1"; 🔥 shows 1 before playing tomorrow and 2 after a win. | | |
| G3 ★ | Block storage (private window with storage disabled, or devtools → Application → Storage → block localStorage), then play. | The game plays normally, nothing is saved, no error is shown. | | |

## H. Midnight rollover (Melbourne time)

Use devtools → Sensors/Clock override (Chrome), or change the system clock. The app
re-reads the date every 30 s and on focus/visibility.

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| H1 | Fake 23:59, finish the day's game, then advance to 00:01 and wait 30 s. | The header number increments by one and the target is new. | | |
| H2 | Fake 23:59, make **no** guess, advance to 00:01 and wait 30 s (or switch tab and back). | The new day's target appears without a reload. | | |
| H3 | Fake 23:59, make one guess, advance past midnight. | The old game stays playable until it finishes; the new day starts only after it ends. | | |

## I. Offline (production build only)

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| I1 | `npm run build && npm run preview -- --host`; load it once online; wait for the page to settle. | Page loads normally; no console error from the service worker. | | |
| I2 | Stop the server (Ctrl-C), then reload the tab; then open a second tab. | Both load from the cache and the game plays; no browser error page. | | |

## J. Keyboard only (no mouse, no trackpad)

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| J1 ★ | Load the page and press Tab repeatedly without touching the mouse. | Focus moves through the header controls, then the map stops, then the panel controls. Every focused control shows a visible ring. | | |
| J2 ★ | On a stop, press the arrow keys, then Enter, then Escape. | Arrows move focus to the neighbouring stop along the track; Enter opens the card with focus already on "Guess this"; Escape closes it and returns focus to the stop. | | |
| J3 ★ | Type a station, use ↑/↓ and Enter. | The highlighted suggestion follows the arrows and Enter guesses it. | | |
| J4 | Play a whole game with the keyboard only, through the result card, "Copy result" and back to Daily. | Everything is reachable and nothing traps focus. | | |

## K. Screen reader (VoiceOver: Cmd-F5 on macOS, or a triple click of the side button on iOS)

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| K1 ★ | With VoiceOver on, make a guess. | It announces "<Name>: N stops away, M changes, Line then Line. K guesses left." and "correct, solved in N" when you win. | | |
| K2 ★ | Type in the guess box and move with the arrows. | The field is announced as "Guess a station"; the highlighted suggestion is announced as it changes. | | |
| K3 | Play to the end. | The result card is announced ("Solved in N!" or "Out of guesses. It was X."). | | |

## L. Theme and motion

| # | Steps | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| L1 ★ | Light appearance, guess a station far from the target. | Light palette; the number inside the grey "far" dot is dark and readable. | | |
| L2 ★ | Switch the OS to dark appearance. | Everything switches; the number inside a "far" dot is now white on grey and still readable. | | |
| L3 | Turn on Reduce Motion (macOS/iOS accessibility settings), then guess. | The route appears without drawing itself in and the change points do not pulse. | | |

## Known limitations — do not fail the build for these

1. **Metro Tunnel through-running shows as a change.** The feed splits the tunnel at
   Town Hall (Sunbury on one side, Cranbourne/Pakenham on the other), so the app counts
   one change where a passenger stays on the train. Record what the planner says; it is
   a data/line-naming artefact, not a routing bug.
2. **City Loop direction.** Routes are chosen by fewest stations, so Parliament →
   Southern Cross is 2 stops via Flinders Street; some real trains run the long way
   round the loop.
3. **Stop counts include stations the train passes**, not just the ones it stops at —
   that is deliberate (an express skip counts the stations it overtakes).
4. **The "Council" hint names the local government area, not the suburb** — deliberate,
   because most stations share their suburb's name.
5. **"Chuggington" is a codename**; the public name is still open (D1, trademark check).
6. Practice targets are random, so two runs never match.

## Report back

Device and browser versions, the commit hash, a Pass/Fail table, screenshots of every
Fail, and the console output from any case that broke. Anything in "Known limitations"
that reads worse in real play than it sounds here is worth a line too.
