<script lang="ts">
  import network from './data/network.json';
  import schematic from './data/schematic.json';
  import geo from './data/geo.json';
  import facts from './data/facts.json';
  import regionalData from './data/regional.json';
  import { regionalTarget } from './engine/regional';
  import { practiceTarget } from './engine/practice';
  import { audioState, play, unlock } from './ui/sound';
  import { warmth } from './engine/warmth';
  import { BADGES, earned, type Happened } from './engine/badges';
  import { emptyCollection, lineProgress, record, type Collection } from './engine/collection';
  import { duelDecode, duelEncode, duelPoints, duelResult, duelStation, duelVerdict, duelIntro, duelMessage, type DuelResult } from './engine/duel';
  import { lineStations, runGiveUp, runGuess, runLeft, runMissed, runOver, runSeconds, runShare, runStart, type RunState } from './engine/linerun';
  import { connectDaily, connectHint, connectMove, connectOver, connectPair, connectShare, connectStart, movesMade, neighbours, stars as connectStars, type ConnectState, type Trend } from './engine/connect';
  import type { Network } from './engine/types';
  import { dayNumber } from './engine/daily';
  import { MAX_GUESSES, HARD_MAX_GUESSES, maxGuesses } from './engine/score';
  import { dailyMode, duelMode, practiceMode, rollover, setHard, solved, useHint, type GuessState } from './engine/modes/daily';
  import { emptyStats, loadJSON, recordResult, saveJSON, shownStreak, type KV, type Stats } from './engine/stats';
  import type { HintId } from './engine/types';
  import HintShop from './ui/HintShop.svelte';
  import type { Layout } from './ui/layout';
  import type { World } from './ui/basemap';
  import MapSvg from './ui/MapSvg.svelte';
  import GuessInput from './ui/GuessInput.svelte';
  import HistorySheet from './ui/HistorySheet.svelte';

  // built from official GTFS by tools/build_data.py and tools/layout.py
  const metroNet = network as Network;
  // V/Line: its own Regional practice mode, and context lines on the metro maps (user, 2026-11-19)
  const reg = regionalData as unknown as { network: Network; geo: Layout; diagram: { stations: Layout; bends: Record<string, [number, number][]> } };
  // two maps: the 0/45/90 diagram (default) and true geography; the choice is a per-browser convenience
  const diagram = schematic as unknown as { stations: Layout; bends: Record<string, [number, number][]>; areas: Record<string, [number, number][]> };
  const real = geo as unknown as { stations: Layout; world: World };
  const factFor = facts as Record<string, { fact: string; source: string }>;
  const SEED = 20260101;
  const modes = { daily: dailyMode, practice: practiceMode, regional: practiceMode, connect: practiceMode, linerun: practiceMode, duel: duelMode, collection: practiceMode };

  // browser storage may be missing (private mode, previews); loadJSON/saveJSON swallow errors
  const kv: KV = (() => { try { return window.localStorage; } catch { return { getItem: () => null, setItem: () => {} }; } })();
  // the Melbourne day, re-read every 30 s and whenever the tab comes back (review R1 finding 1)
  let today = $state(dayNumber(new Date()));
  const dailyKey = (n: number) => `chug:daily:${n}`;

  // Hard is a preference: every new guess game starts in it (a game already started keeps its own setting)
  // The Daily keeps its own, and starts in Hard (user, 2026-11-21); the other guess games start in Easy.
  let hardPref = $state<boolean>(loadJSON(kv, 'chug:hard', false));
  let dailyHardPref = $state<boolean>(loadJSON(kv, 'chug:hard:daily', true));
  const withPref = (g: GuessState, daily = false) => (g.guesses.length || g.hints.length ? g : setHard(g, daily ? dailyHardPref : hardPref));

  /** Today's game, restored if this browser already started it and it is for the same target. */
  function todaysGame(): GuessState {
    const fresh = dailyMode.init(metroNet, { seed: SEED, game: today }); // the daily is always metro
    const saved = loadJSON<GuessState | null>(kv, dailyKey(today), null);
    return withPref(saved && saved.targetId === fresh.targetId && Array.isArray(saved.guesses) ? saved : fresh, true);
  }

  // a duel link (#duel=code) opens that station for a friend to play, in the challenger's mode
  // (Easy or Hard), with their score to beat. Each station's duel is saved, so a reload can't
  // restart it, and a reply link for a station you already played shows the result, not a replay.
  // theirs = null: your own new challenge, to send once you've played it
  type Duel = { station: string; targetId: string; theirs: DuelResult | null };
  const duelKey = (station: string) => `chug:duel:${station}`;
  const stationCode = (targetId: string) => duelStation(duelEncode(metroNet, targetId, { guesses: null, spent: 0, hard: false }));
  function duelFrom(hash: string): { duel: Duel; game: GuessState } | null {
    const code = hash.startsWith('#duel=') ? hash.slice(6) : '';
    const d = duelDecode(metroNet, code);
    if (!d) return null;
    const duel = { station: duelStation(code), targetId: d.targetId, theirs: d.result };
    return { duel, game: duelSaved(duel) };
  }
  function duelSaved(duel: Duel): GuessState {
    const saved = loadJSON<GuessState | null>(kv, duelKey(duel.station), null);
    if (saved && saved.targetId === duel.targetId && Array.isArray(saved.guesses)) return saved;
    return { ...duelMode.init(metroNet, { seed: SEED, targetId: duel.targetId }), hard: duel.theirs ? duel.theirs.hard : hardPref };
  }
  // the duel you're in, remembered so the menu can take you back to it after a reload
  function lastDuel(): Duel | null {
    const d = loadJSON<Duel | null>(kv, 'chug:duel:last', null);
    return d && typeof d.station === 'string' && metroNet.stations.some((s) => s.id === d.targetId) ? d : null;
  }
  const duelIn = typeof location !== 'undefined' ? duelFrom(location.hash) : null;
  let duel = $state<Duel | null>(duelIn?.duel ?? lastDuel());
  if (duelIn) saveJSON(kv, 'chug:duel:last', duelIn.duel);
  let mode = $state<keyof typeof modes>(duelIn ? 'duel' : 'daily');
  let game = $state<GuessState>(duelIn ? duelIn.game : todaysGame());
  let stats = $state<Stats>(loadJSON(kv, 'chug:stats', emptyStats()));
  let help = $state<HTMLDialogElement>();
  // the real map is the default (user, 2026-11-19); the diagram is one tap away
  let mapMode = $state<'diagram' | 'geo'>(loadJSON<string>(kv, 'chug:map', 'geo') === 'diagram' ? 'diagram' : 'geo');
  const net = $derived(mode === 'regional' ? reg.network : metroNet);
  // the map opens on the city: the Zone 1 and 1/2 stations (user, 2026-11-19)
  const cityHome = metroNet.stations.filter((s) => s.zone === '1' || s.zone === '1/2').map((s) => s.id);
  const metroLayout = $derived(mapMode === 'geo' ? real.stations : diagram.stations);
  const regLayout = $derived(mapMode === 'geo' ? reg.geo : reg.diagram.stations);
  const layout = $derived(mode === 'regional' ? regLayout : metroLayout);
  const bends = $derived(mapMode !== 'diagram' ? {} : mode === 'regional' ? reg.diagram.bends : diagram.bends);
  // the other network, drawn faintly underneath for context
  const context = $derived(mode === 'regional'
    ? { net: metroNet, layout: metroLayout, bends: mapMode === 'diagram' ? diagram.bends : {} }
    : { net: reg.network, layout: regLayout, bends: mapMode === 'diagram' ? reg.diagram.bends : {} });
  function setMap(m: 'diagram' | 'geo') { mapMode = m; saveJSON(kv, 'chug:map', m); }

  $effect(() => {
    const tick = () => { today = dayNumber(new Date()); };
    const id = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  });
  $effect(() => {
    if (rollover(game, today)) { game = todaysGame(); selected = null; copied = false; }
  });
  let selected = $state<string | null>(null);
  let focusGuess = $state<string | null>(null); // a history row the player tapped (null = the latest guess)
  let panel = $state<HTMLElement>();
  let glow = $state(new Set<string>());
  let labels = $state<boolean>(loadJSON(kv, 'chug:labels', true)); // Easy: big interchanges named; all names when zoomed in
  $effect(() => { saveJSON(kv, 'chug:labels', labels); });
  let copied = $state(false);

  const m = $derived(modes[mode]);
  const guessGame = $derived(mode === 'daily' || mode === 'practice' || mode === 'regional' || mode === 'duel');
  const hardHere = $derived(guessGame && game.hard); // Hard only shapes the guess games' map
  const started = $derived(game.guesses.length > 0 || game.hints.length > 0);
  // Connect: its own state (a path, not guesses)
  let cx = $state<ConnectState | null>(null);
  let cxMsg = $state('');
  let cxTrend = $state<Trend | null>(null);
  let cxHintAt = $state<string | null>(null); // the station a "Which way?" pointed to
  let cxDaily = $state(true);                 // today's shared pair, or a practice pair
  const cxKey = (n: number) => `chug:connect:${n}`;
  const isConnect = $derived(mode === 'connect' && !!cx);
  const cxHere = $derived(cx ? cx.path[cx.path.length - 1] : '');
  const cxNext = $derived(new Set(cx ? neighbours(metroNet, cxHere) : []));
  const cxKnown = $derived(new Set(cx ? [...cx.path, cx.to] : []));
  const nameOf = (id: string) => metroNet.stations.find((s) => s.id === id)?.name ?? id;
  function newConnect() {
    const [a, b] = connectPair(metroNet, Math.random, Math.random);
    cx = connectStart(metroNet, a, b);
    cxDaily = false; cxMsg = ''; cxTrend = null; cxHintAt = null; copied = false; selected = null;
  }
  function whichWay() {
    if (!cx) return;
    const h = connectHint(metroNet, cx);
    cx = h.state;
    cxHintAt = h.next;
    if (sound) play('first');
    cxMsg = h.next ? `Try ${nameOf(h.next)}.` : '';
    if (cxDaily) saveJSON(kv, cxKey(today), cx);
  }
  function move(id: string) {
    if (!cx) return;
    const r = connectMove(metroNet, cx, id);
    cxMsg = r.ok ? '' : r.reason === 'not next door' ? `${nameOf(id)} isn't next to ${nameOf(cxHere)}.` : '';
    if (sound && !r.ok && r.reason === 'not next door') play('colder');
    cx = r.state;
    selected = null;
    if (r.ok) {
      cxTrend = r.trend ?? null;
      cxHintAt = null;
      const reached = cx.path.at(-1) === cx.to;
      if (sound) play(reached ? 'hit' : r.trend === 'closer' ? 'warmer' : r.trend === 'further' ? 'colder' : 'same');
      if (cxDaily) saveJSON(kv, cxKey(today), cx);
    }
    if (cx && connectOver(cx) && cx.path.at(-1) === cx.to) {
      try { navigator.vibrate?.([30, 40, 60]); } catch { /* not supported */ }
    }
  }
  // Line Run: name every station on one line against the clock
  let run = $state<RunState | null>(null);
  let runMsg = $state<{ ok: boolean; text: string } | null>(null);
  let runPick = $state(''); // the line chosen on the ready screen ('' = random)
  const inRun = $derived(mode === 'linerun'); // ready screen or playing
  let now = $state(Date.now());
  const isRun = $derived(mode === 'linerun' && !!run);
  const runLine = $derived(run ? metroNet.lines.find((l) => l.id === run!.line)! : null);
  const runAll = $derived(run ? lineStations(metroNet, run.line) : []);
  const runFound = $derived(new Set(run?.found ?? []));
  // the clock running out sounds once, like any other end
  let runEndHeard = '';
  $effect(() => {
    if (!run || !isRun || run.doneAt || !runOver(run, now)) return;
    const key = `${run.line}:${run.startedAt}`;
    if (runEndHeard === key) return;
    runEndHeard = key;
    if (sound) play('colder');
  });
  $effect(() => {
    if (!isRun) return;
    const t = setInterval(() => { now = Date.now(); }, 250);
    return () => clearInterval(t);
  });
  const runLines = metroNet.lines.filter((l) => lineStations(metroNet, l.id).length >= 6);
  // the ready screen: nothing ticks until Start
  function readyRun() {
    mode = 'linerun'; cx = null; run = null;
    runMsg = null; selected = null; copied = false;
  }
  function startRun() {
    const pick = runPick || runLines[Math.floor(Math.random() * runLines.length)].id;
    run = runStart(metroNet, pick, Date.now());
    now = Date.now();
    if (sound) play('warmer');
    runMsg = null; selected = null; copied = false;
  }
  function giveUp() {
    if (run && !run.doneAt && sound) play('colder');
    if (run) run = runGiveUp(run, Date.now());
  }
  function runName(id: string) {
    if (!run) return;
    const r = runGuess(metroNet, run, id, Date.now());
    run = r.state;
    runMsg = r.result === 'miss' ? { ok: false, text: `${nameOf(id)} isn't on the ${runLine?.name} line.` }
      : r.result === 'again' ? { ok: false, text: `${nameOf(id)} is already found.` }
      : r.result === 'found' ? { ok: true, text: `✓ ${nameOf(id)}` } : null;
    if (sound && r.result !== 'over') play(r.result === 'found' ? (run.doneAt ? 'hit' : 'warmer') : 'colder');
    selected = null;
  }
  const fmtClock = (ms: number) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const over = $derived(isConnect ? connectOver(cx!) : isRun ? runOver(run!, now) : m.isOver(game));
  const used = $derived(new Set(game.guesses.map((g) => g.stationId)));
  const sel = $derived(selected ? net.stations.find((s) => s.id === selected) : undefined);
  const lineById = $derived(Object.fromEntries(net.lines.map((l) => [l.id, l])));
  // diagram key: lines that share a colour share a row, like a printed network map
  const legend = $derived(Object.values(net.lines.reduce((m, l) => {
    (m[l.colour] ??= { colour: l.colour, list: [] as string[] }).list.push(l.name);
    return m;
  }, {} as Record<string, { colour: string; list: string[] }>)).map((g) => ({ colour: g.colour, names: g.list.sort().join(', ') })));
  const target = $derived(net.stations.find((s) => s.id === game.targetId)!);

  function persist() {
    if (mode === 'duel' && duel) saveJSON(kv, duelKey(duel.station), game);
    if (mode !== 'daily') return;
    saveJSON(kv, dailyKey(game.game), game);
    if (m.isOver(game)) {
      stats = recordResult(stats, game.game, solved(game), game.guesses.length);
      saveJSON(kv, 'chug:stats', stats);
    }
  }

  // on by default; the help dialog turns it off. A new key: 'chug:sound' could hold an "off" saved
  // while sound used to start off, which kept some players silent after the default changed.
  let sound = $state<boolean>(loadJSON(kv, 'chug:sound:v2', true));
  function setSound(on: boolean) {
    sound = on; saveJSON(kv, 'chug:sound:v2', on);
    if (on) play('warmer'); // a test cue, so you know it works
  }
  // browsers only start audio during a tap or key press: wake it on the first one, so cues that
  // come later on their own (the Line Run clock running out) can play too
  // (Safari counts a click or touch-end, not a press-down, so listen for all until audio runs)
  const WAKE = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
  $effect(() => {
    const wake = () => {
      if (!sound) return;
      void unlock().then(() => { if (audioState() === 'running') WAKE.forEach((t) => removeEventListener(t, wake, true)); });
    };
    WAKE.forEach((t) => addEventListener(t, wake, true));
    return () => WAKE.forEach((t) => removeEventListener(t, wake, true));
  });
  let audioNow = $state(audioState());
  function testSound() {
    play('hit');
    audioNow = audioState(); // at once ("waiting for a tap" if the browser holds audio back) ...
    void unlock().then(() => (audioNow = audioState())); // ... and again once it lets go
  }
  function guess(id: string) {
    const before = game.guesses.length;
    game = m.guess(net, game, id);
    if (sound && game.guesses.length > before) play(warmth(game.guesses).at(-1)!);
    selected = null;
    focusGuess = null;
    persist();
    if (solved(game)) {
      try { navigator.vibrate?.([30, 40, 60]); } catch { /* not supported */ }
      requestAnimationFrame(() => panel?.scrollTo({ top: 0, behavior: 'smooth' })); // the result sits at the top
    }
  }

  // the Hard box always answers: it switches this game when the rules allow, and otherwise
  // sets the next game and says so (raising to Hard mid-game would add guesses)
  let hardNote = $state('');
  let hardNoteTimer: ReturnType<typeof setTimeout> | undefined;
  function toggleHard(on: boolean, box: HTMLInputElement) {
    game = setHard(game, on);
    const daily = mode === 'daily';
    if (daily) { dailyHardPref = on; saveJSON(kv, 'chug:hard:daily', on); }
    else { hardPref = on; saveJSON(kv, 'chug:hard', on); }
    box.checked = game.hard; // the box shows this game's mode, even when the switch was refused
    const next = daily ? "tomorrow's Daily" : 'your next game';
    hardNote = game.hard === on ? ''
      : on ? `This game is in Easy. Hard starts with ${next}.`
      : `Hard stays on for this game. Easy starts with ${next}.`;
    clearTimeout(hardNoteTimer);
    if (hardNote) hardNoteTimer = setTimeout(() => (hardNote = ''), 4000);
    persist();
  }

  function buy(h: HintId) {
    const before = game.hints.length;
    game = useHint(net, game, h);
    if (sound && game.hints.length > before) play('first');
    persist();
  }

  function start(next: keyof typeof modes) {
    // a duel lives in the link only until you leave it; the menu keeps the way back
    if (mode === 'duel' && next !== 'duel' && location.hash.startsWith('#duel=')) history.replaceState(null, '', location.pathname + location.search);
    mode = next;
    run = null;
    linkCopied = '';
    // modes without a guess game of their own keep the metro daily underneath, so the game always
    // matches the network on the map (a V/Line game left over from Regional broke the map)
    if (next === 'collection' || next === 'linerun' || next === 'connect') { game = todaysGame(); focusGuess = null; }
    if (next === 'collection') { cx = null; selected = null; return; }
    if (next === 'linerun') { readyRun(); return; }
    if (next === 'connect') {
      // today's shared pair (restored if already started), like the daily station
      const [a, b] = connectDaily(metroNet, today);
      const saved = loadJSON<ConnectState | null>(kv, cxKey(today), null);
      cx = saved && saved.from === a && saved.to === b ? saved : connectStart(metroNet, a, b);
      cxDaily = true;
      cxMsg = ''; cxTrend = null; cxHintAt = null;
      selected = null;
      copied = false;
      return;
    }
    cx = null;
    if (next === 'duel') {
      if (duel) game = duelSaved(duel);
      else newDuel();
      selected = null; copied = false; focusGuess = null;
      return;
    }
    game = next === 'daily'
      ? todaysGame()
      : next === 'regional'
        ? practiceMode.init(reg.network, { seed: SEED, targetId: regionalTarget(reg.network, metroNet, Math.random).id })
        : practiceMode.init(metroNet, { seed: SEED, targetId: practiceTarget(metroNet, practiceLine, Math.random) });
    game = withPref(game, next === 'daily');
    selected = null;
    copied = false;
  }

  // spoken after each guess (review R1 finding 2); the map and history only show it
  const announce = $derived.by(() => {
    if (!guessGame) return '';
    const g = game.guesses.at(-1);
    if (!g) return '';
    const name = net.stations.find((x) => x.id === g.stationId)?.name ?? '';
    if (g.correct) return `${name}: correct, solved in ${game.guesses.length}.`;
    if (!g.route) return `${name}: no route.`;
    // Hard does not tell the lines, not even to a screen reader
    const lines = game.hard && !over ? '' : `, ${g.route.lines.map((l) => lineById[l].name).join(' then ')}`;
    const left = maxGuesses(game.hard) - game.guesses.length;
    return `${name}: ${g.route.stops} stops away, ${g.route.changes} ${g.route.changes === 1 ? 'change' : 'changes'}${lines}. ${left} ${left === 1 ? 'guess' : 'guesses'} left.`;
  });

  // a stop card takes focus so its button is one Tab away; Escape returns to the stop (finding 3)
  let cardBtn = $state<HTMLButtonElement>();
  let cardEl = $state<HTMLDivElement>();
  let lastStop: string | null = null;
  $effect(() => { if (selected) { lastStop = selected; (cardBtn ?? cardEl)?.focus(); } });
  function closeCard() {
    selected = null;
    if (lastStop) document.getElementById(`stop-${lastStop}`)?.focus();
  }

  // themed practice: the hidden station comes from one line (null = any)
  let practiceLine = $state<string | null>(null);
  function setTheme(line: string) { practiceLine = line || null; start('practice'); }

  // badges, earned once each, kept in this browser
  let badges = $state<string[]>(loadJSON(kv, 'chug:badges', [] as string[]));
  let toast = $state<{ id: string; name: string; text: string }[]>([]);

  // station collection: every metro station met across games, kept in this browser
  let coll = $state<Collection>(loadJSON(kv, 'chug:collection', emptyCollection()));
  const isColl = $derived(mode === 'collection');
  const collProgress = $derived(lineProgress(coll, metroNet));
  const collect = $derived(isColl ? { seen: new Set(coll.seen), found: new Set(coll.found) } : undefined);
  let recordedFor = '';
  $effect(() => {
    if (!over || isColl) return;
    let seen: string[] = [], found: string | null = null, key = '';
    if (isConnect && cx) { seen = cx.path; key = `c:${cx.from}:${cx.to}:${cx.path.length}`; }
    else if (isRun && run) { seen = run.found; key = `r:${run.line}:${run.startedAt}`; }
    else if (mode !== 'regional') {
      seen = game.guesses.map((g) => g.stationId);
      found = solved(game) ? game.targetId : null;
      key = `g:${mode}:${game.game}:${game.targetId}:${game.guesses.length}`;
    }
    if (!key || key === recordedFor) return;
    recordedFor = key;
    coll = record(coll, seen, found);
    saveJSON(kv, 'chug:collection', coll);
    // badges for what just happened
    const met = coll.seen.length;
    const events: Happened[] = [];
    if (isConnect && cx && cx.path.at(-1) === cx.to) events.push({ kind: 'connect', moves: cx.path.length - 1, par: cx.par, met });
    else if (isRun && run) events.push({ kind: 'linerun', complete: run.found.length === runAll.length, met });
    else if (found) {
      events.push({ kind: 'solved', guesses: game.guesses.length, streak: mode === 'daily' ? stats.current : 0, met });
      if (mode === 'duel' && duel?.theirs) events.push({ kind: 'duel', verdict: duelVerdict(duelResult(game), duel.theirs), met });
    } else if (mode === 'duel' && duel?.theirs) events.push({ kind: 'duel', verdict: duelVerdict(duelResult(game), duel.theirs), met });
    else events.push({ kind: 'linerun', complete: false, met }); // only the collection milestones apply
    const fresh = [...new Set(events.flatMap((e) => earned(e, badges)))];
    if (fresh.length) {
      badges = [...badges, ...fresh];
      saveJSON(kv, 'chug:badges', badges);
      toast = fresh.map((id) => BADGES.find((b) => b.id === id)!);
      const t = setTimeout(() => (toast = []), 5000);
      return () => clearTimeout(t);
    }
  });

  // a duel link opened in a tab that already has the game: start the duel without a reload
  $effect(() => {
    const onHash = () => {
      const d = duelFrom(location.hash);
      if (!d) return;
      mode = 'duel'; cx = null; run = null;
      duel = d.duel; game = d.game; saveJSON(kv, 'chug:duel:last', d.duel);
      selected = null; copied = false; linkCopied = ''; focusGuess = null;
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  // Challenge a friend: a link to this game's station, carrying my result
  // a new challenge: a random station; you play it first, then send it
  function newDuel() {
    const targetId = practiceTarget(metroNet, null, Math.random);
    duel = { station: stationCode(targetId), targetId, theirs: null };
    saveJSON(kv, 'chug:duel:last', duel);
    game = withPref(duelMode.init(metroNet, { seed: SEED, targetId }));
    persist();
  }

  function freshDuel() {
    if (location.hash.startsWith('#duel=')) history.replaceState(null, '', location.pathname + location.search);
    newDuel();
    selected = null; copied = false; linkCopied = ''; focusGuess = null;
  }

  // Challenge a friend (or answer one): a link to this game's station, carrying my result.
  // On a phone it opens the share sheet; elsewhere, or if sharing fails, it copies the message.
  let linkCopied = $state<'' | 'copied' | 'shared'>('');
  async function challenge() {
    const mine = duelResult(game);
    const code = duelEncode(metroNet, game.targetId, mine);
    saveJSON(kv, duelKey(duelStation(code)), game); // so their reply shows your game against theirs
    const url = `${location.origin}${location.pathname}#duel=${code}`;
    const text = duelMessage(mine, mode === 'duel' ? duel?.theirs ?? null : null, url);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ text }); linkCopied = 'shared'; return; }
      catch (e) { if ((e as Error)?.name === 'AbortError') return; } // closed the sheet: nothing sent
    }
    try { await navigator.clipboard.writeText(text); linkCopied = 'copied'; } catch { linkCopied = ''; }
  }

  async function share() {
    const text = isConnect ? connectShare(cx!) : isRun ? runShare(metroNet, run!, now) : m.share(game);
    try { await navigator.clipboard.writeText(text); copied = true; } catch { copied = false; }
  }
</script>

<div class="app">
  <header class="top">
    <strong>Stops Away</strong>
    <span class="meta">{mode === 'daily' ? `#${game.game}` : mode === 'regional' ? 'Regional · V/Line' : mode === 'connect' ? (cxDaily ? `Connect #${today}` : 'Connect · practice') : mode === 'linerun' ? 'Line Run' : mode === 'collection' ? 'My stations' : mode === 'practice' && practiceLine ? `Practice · ${metroNet.lines.find((l) => l.id === practiceLine)?.name} line` : mode === 'duel' && duel ? `Duel${game.hard ? ' · Hard' : ''} · ${!duel.theirs ? 'new challenge' : duel.theirs.guesses === null ? 'they missed it' : `beat ${duelPoints(duel.theirs)} pts`}` : 'Practice'}</span>
    <span class="meta" title="Daily streak">🔥 {shownStreak(stats, today)}</span>
    <nav>
      <!-- every way to play in one menu, so the header fits a phone -->
      <select class="modesel" aria-label="Mode" value={mode} onchange={(e) => start(e.currentTarget.value as keyof typeof modes)}>
        <option value="daily">Daily</option>
        <option value="practice">Practice</option>
        <option value="regional">Regional (V/Line)</option>
        <option value="connect">Connect</option>
        <option value="linerun">Line Run</option>
        <option value="duel">Duel</option>
        <option value="collection">My map</option>
      </select>
      <!-- Connect and Line Run decide themselves which names show; Hard belongs to the guess games -->
      {#if !isConnect && !inRun}
        <label class="switch" title={hardHere ? 'Hard mode shows no names' : 'Name the big stations; zoom in for all'}>
          <input type="checkbox" role="switch" checked={labels && !hardHere} disabled={hardHere} onchange={(e) => (labels = e.currentTarget.checked)} /><span class="knob" aria-hidden="true"></span>Labels</label>
      {/if}
      <!-- a friend's duel is played in the challenger's mode, so it has no Hard switch -->
      {#if guessGame && !(mode === 'duel' && duel?.theirs)}
        <label class="switch hard" title="No names or lines; 12 guesses; hints cost double">
          <input type="checkbox" role="switch" checked={game.hard} onchange={(e) => toggleHard(e.currentTarget.checked, e.currentTarget)} /><span class="knob" aria-hidden="true"></span>Hard</label>
      {/if}
      <button type="button" aria-label="How to play" onclick={() => help?.showModal()}>?</button>
    </nav>
  </header>

  <main class="map-wrap">
    <div class="mapmode" role="group" aria-label="Map style">
      <button type="button" aria-pressed={mapMode === 'geo'} onclick={() => setMap('geo')}>Map</button>
      <button type="button" aria-pressed={mapMode === 'diagram'} onclick={() => setMap('diagram')}>Diagram</button>
    </div>
    {#if mapMode === 'diagram' && !hardHere}
      <details class="legend">
        <summary>Lines</summary>
        <ul>
          {#each legend as g (g.colour)}
            <li><span class="swatch" style="--c:{g.colour}"></span>{g.names}</li>
          {/each}
        </ul>
      </details>
    {/if}
    <MapSvg {net} {layout} {bends} {context} home={mode === 'regional' ? undefined : cityHome} trail={isConnect ? cx?.path : undefined} you={isConnect && !over ? cxHere : undefined}
      frame={isConnect && cx ? { key: `${cx.from}>${cx.to}:${cx.path.length}`, ids: [cxHere, cx.to, ...cxNext] }
        : isRun && run ? { key: `run:${run.line}:${run.startedAt}`, ids: runAll } : undefined} ends={isConnect && cx ? { from: cx.from, to: cx.to } : undefined} world={mapMode === 'geo' ? real.world : undefined} diagram={mapMode === 'diagram'} areas={diagram.areas} {over} focus={focusGuess} guesses={isConnect || inRun || isColl ? [] : game.guesses} {selected} {collect}
      glow={isRun ? (over ? new Set(runAll) : runFound) : isConnect ? (over ? new Set() : cxHintAt ? new Set([cxHintAt]) : cxNext) : hardHere ? new Set() : glow}
      spotlight={isRun ? run?.line : inRun ? runPick || undefined : undefined} labels={labels && !hardHere && !inRun} plain={hardHere}
      nameless={(isConnect || inRun) && !over} named={isRun && !over ? runFound : undefined}
      onselect={(id) => (selected = id)} />

    {#if sel}
      <!-- a tapped stop is named only where names are on: not in Hard, not with Labels off, not before you reach or find it -->
      {@const unlabelled = !labels && !hardHere && !isConnect && !inRun && !over && !used.has(sel.id) && !(isColl && coll.seen.includes(sel.id))}
      {@const hidden = (hardHere && !used.has(sel.id)) || (isConnect && !over && !cxKnown.has(sel.id)) || (inRun && !over && !runFound.has(sel.id)) || unlabelled}
      <!-- tapping a stop to guess it is a Practice aid; every other mode, and Hard, is played by name (user, 2026-11-21) -->
      {@const tapGuess = mode === 'practice' && !hardHere}
      <div class="card" role="dialog" bind:this={cardEl} aria-label={hidden ? 'This stop' : sel.name} tabindex="-1"
        onkeydown={(e) => { if (e.key === 'Escape') closeCard(); }}>
        <div class="card-head">
          <strong>{hidden ? 'This stop' : sel.name}</strong>
          <button type="button" class="x" aria-label="Close" onclick={closeCard}>×</button>
        </div>
        <div class="chips" class:gone={hidden && !unlabelled}>
          {#each hidden && !unlabelled ? [] : sel.lines as l (l)}
            <span class="chip" style="--c:{lineById[l].colour}">{lineById[l].name}</span>
          {/each}
          {#if sel.zone}<span class="zone">Zone {sel.zone}</span>{/if}
        </div>
        {#if inRun}
          {#if !over}<p class="cardnote">{runFound.has(sel.id) ? 'Found.' : 'Type a name to answer.'}</p>{/if}
        {:else if isConnect}
          {#if !over}<p class="cardnote">{sel.id === cxHere ? "You're here." : cxNext.has(sel.id) ? 'Next door. Type its name to move here.' : cxKnown.has(sel.id) ? 'Already on your route.' : `Not next to ${nameOf(cxHere)}.`}</p>{/if}
        {:else if !tapGuess}
          {#if !over && !isColl}<p class="cardnote">{used.has(sel.id) ? 'Already guessed.' : hidden ? 'Type a name to guess.' : 'Type its name to guess.'}</p>{/if}
        {:else}
        <button bind:this={cardBtn} type="button" class="primary" disabled={over || used.has(sel.id)} onclick={() => guess(sel.id)}>
          {used.has(sel.id) ? 'Already guessed' : over ? 'Game over' : 'Guess this'}
        </button>
        {/if}
      </div>
    {/if}
  </main>

  <aside class="panel" bind:this={panel}>
    {#if isColl}
      <section class="connect collection" aria-label="My stations">
        <p class="route"><b>{coll.seen.length}</b> of {metroNet.stations.length} stations met · <b>{coll.found.length}</b> found</p>
        <p class="sub">Gold: found as the answer. Ringed: guessed, passed through or named. Play any mode to fill in your map.</p>
        <ul class="badges" aria-label="Badges">
          {#each BADGES as b (b.id)}
            <li class:earned={badges.includes(b.id)} title={b.text}><b>{b.name}</b><span>{b.text}</span></li>
          {/each}
        </ul>
        <ul class="progress">
          {#each collProgress.filter((p) => p.total >= 4) as p (p.line)}
            <li>
              <span class="pname">{p.name}</span>
              <span class="bar" style="--c:{p.colour}"><span style="width:{(100 * p.seen) / p.total}%"></span></span>
              <span class="pnum">{p.seen}/{p.total}</span>
            </li>
          {/each}
        </ul>
      </section>
    {:else if inRun && !run}
      {@const pickLine = runPick ? metroNet.lines.find((l) => l.id === runPick) : null}
      {@const n = runPick ? lineStations(metroNet, runPick).length : 0}
      <section class="connect runready" aria-label="Line Run">
        <p class="route">Name every station on a line before the clock runs out.</p>
        <label class="sub pickline"><span>Line</span>
          <select value={runPick} onchange={(e) => (runPick = e.currentTarget.value)}>
            <option value="">Surprise me</option>
            {#each runLines as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
          </select>
        </label>
        <p class="sub">{#if pickLine}<span class="linebadge" style="--c:{pickLine.colour}"></span><b>{n} stations</b> · <b>{fmtClock(runSeconds(n) * 1000)}</b> on the clock
          {:else}A random line. The clock is 20 seconds plus 8 a station.{/if}</p>
        <button type="button" class="primary" onclick={startRun}>Start</button>
      </section>
    {:else if isRun && run && runLine}
      {@const left = runLeft(run, now)}
      {@const missed = runMissed(metroNet, run)}
      {#if over}
        <div class="result" role="status">
          <p>{missed.length === 0 ? `All ${runAll.length} found!` : `${run.doneAt ? 'Stopped' : 'Time!'} ${run.found.length} of ${runAll.length} found.`}</p>
          {#if missed.length}<p class="missed"><b>Missed:</b> {missed.map(nameOf).sort().join(', ')}</p>{/if}
          <pre>{runShare(metroNet, run, now)}</pre>
          <div class="row">
            <button type="button" class="primary" onclick={share}>{copied ? 'Copied' : 'Copy result'}</button>
            <button type="button" onclick={readyRun}>New Line Run</button>
          </div>
        </div>
      {/if}
      <section class="connect" aria-label="Line Run">
        <p class="route"><span class="linebadge" style="--c:{runLine.colour}"></span><b>{runLine.name} line</b>
          <span class="runcount"><b>{run.found.length}</b>/{runAll.length}</span></p>
        {#if !over}
          <div class="runbar" style="--c:{runLine.colour}" aria-hidden="true"><span style="width:{(100 * left) / (run.seconds * 1000)}%"></span></div>
          <p class="sub runclock"><span class="clock" class:low={left < 20000}>{fmtClock(left)}</span> left
            <button type="button" class="giveup" onclick={giveUp}>Give up</button></p>
          {#if runMsg}{#key runMsg}<p class="runmsg" class:ok={runMsg.ok} class:bad={!runMsg.ok} role={runMsg.ok ? 'status' : 'alert'}>{runMsg.text}</p>{/key}{/if}
        {/if}
      </section>
      <GuessInput stations={metroNet.stations.filter((s) => !runFound.has(s.id))} disabled={over} used={new Set()} onguess={runName} onmatches={() => {}}
        placeholder="Name a station on the line…" />
    {:else if isConnect && cx}
      {@const won = cx.path[cx.path.length - 1] === cx.to}
      {#if over}
        <div class="result" role="status">
          <p>{won ? `Reached ${nameOf(cx.to)} in ${movesMade(cx)} (par ${cx.par})!` : `Out of moves. ${nameOf(cx.to)} was ${cx.par} stops from the start.`}</p>
          {#if won}<p class="stars" aria-label="{connectStars(cx)} of 3 stars">{'★'.repeat(connectStars(cx))}<span>{'★'.repeat(3 - connectStars(cx))}</span></p>{/if}
          <pre>{connectShare(cx)}</pre>
          <div class="row">
            <button type="button" class="primary" onclick={share}>{copied ? 'Copied' : 'Copy result'}</button>
            <button type="button" onclick={newConnect}>New Connect</button>
          </div>
        </div>
      {/if}
      <section class="connect" aria-label="Connect">
        <p class="route"><b>{nameOf(cx.from)}</b> → <b>{nameOf(cx.to)}</b></p>
        <p class="sub">Par {cx.par} · moves {movesMade(cx)} · you're at <b>{nameOf(cxHere)}</b></p>
        {#if cxTrend && !over}
          <p class="trend {cxTrend}" role="status">{cxTrend === 'closer' ? 'Closer' : cxTrend === 'further' ? 'Further away' : 'Same distance'}</p>
        {/if}
        {#if cxMsg}<p class="warn" role="alert">{cxMsg}</p>{/if}
        {#if !over}
          <p class="sub">Type the name of a station next to {nameOf(cxHere)}. The glowing stops are next door.</p>
          <button type="button" class="whichway" onclick={whichWay}>Which way? <span>−1 ★</span></button>
        {/if}
      </section>
      <GuessInput stations={metroNet.stations.filter((s) => s.id !== cxHere)} disabled={over} used={new Set()} onguess={move} onmatches={() => {}}
        placeholder="Name the next stop…" />
    {:else}
    {#if over}
      <div class="result" role="status">
        <p>{solved(game) ? `Solved in ${game.guesses.length}!` : `Out of guesses. It was ${target.name}.`}</p>
        {#if mode === 'duel' && duel?.theirs}
          {@const mine = duelResult(game)}
          {@const v = duelVerdict(mine, duel.theirs)}
          <p class="verdict {v}">{v === 'win' ? 'You win!' : v === 'lose' ? 'They win.' : 'A draw.'}
            {mine.guesses === null ? '✗' : duelPoints(mine)} vs their {duel.theirs.guesses === null ? '✗' : `${duelPoints(duel.theirs)} pts`}</p>
          <p class="sub">{duel.theirs.guesses === null ? 'They missed it.' : `They took ${duel.theirs.guesses} ${duel.theirs.guesses === 1 ? 'guess' : 'guesses'}${duel.theirs.spent ? ` and ${duel.theirs.spent} hint points` : ', no hints'}.`}
            Points are hint points left plus 10 per unused guess.</p>
        {/if}
        <pre>{m.share(game)}</pre>
        {#if factFor[game.targetId]}
          <p class="fact">{factFor[game.targetId].fact}
            <a href={factFor[game.targetId].source} target="_blank" rel="noreferrer">Source</a></p>
        {/if}
        {#if mode === 'daily'}
          <p class="stats">Played {stats.played} · Won {stats.wins} · Streak {stats.current} · Best {stats.best}</p>
        {/if}
        <div class="row">
          {#if mode === 'duel'}
            <!-- in a duel the link is the result: it carries your score to your friend -->
            <button type="button" class="primary" onclick={challenge}>{linkCopied === 'shared' ? 'Sent' : linkCopied ? 'Link copied' : duel?.theirs ? 'Send your result' : 'Challenge a friend'}</button>
            <button type="button" onclick={freshDuel}>New challenge</button>
          {:else}
            <button type="button" class="primary" onclick={share}>{copied ? 'Copied' : 'Copy result'}</button>
            <button type="button" onclick={() => start('practice')}>Practice game</button>
            {#if mode === 'practice'}
              <button type="button" onclick={challenge}>{linkCopied === 'shared' ? 'Sent' : linkCopied ? 'Link copied' : 'Challenge a friend'}</button>
            {/if}
          {/if}
        </div>
        {#if linkCopied === 'copied'}<p class="sub">Paste it to a friend. They play the same station{duel?.theirs && mode === 'duel' ? ' and see who won' : ''}.</p>{/if}
      </div>
    {/if}
    {#if mode === 'practice' && game.guesses.length === 0 && game.hints.length === 0}
      <label class="theme"><span>Line</span><select value={practiceLine ?? ''} onchange={(e) => setTheme(e.currentTarget.value)}>
        <option value="">Any line</option>
        {#each metroNet.lines.filter((l) => l.id !== 'RCE') as l (l.id)}<option value={l.id}>{l.name} line</option>{/each}
      </select></label>
    {/if}
    {#if mode === 'duel' && duel && !over}
      <p class="duelintro">{duel.theirs ? duelIntro(duel.theirs) : 'Find this station, then send it to a friend to beat your score.'}</p>
    {/if}
    {#if !over}
      <HintShop {net} targetId={game.targetId} hints={game.hints} {over} hard={game.hard} onbuy={buy} />
    {/if}
    <HistorySheet {net} guesses={game.guesses} max={maxGuesses(game.hard)} hideLines={game.hard && !over} focus={focusGuess} onfocus={(id) => (focusGuess = id)} />
    <GuessInput stations={net.stations} disabled={over} {used} onguess={guess} onmatches={(ids) => (glow = ids)} />
    {/if}
  </aside>
  <dialog bind:this={help} class="help" aria-label="How to play">
    <h2>How to play</h2>
    <p>Find the hidden Melbourne train station in {MAX_GUESSES} guesses ({HARD_MAX_GUESSES} in Hard). Type a station's name to guess; in Practice you can also tap a stop on the map.</p>
    <p>Each guess shows how many <b>stops</b> it is from the target, how many <b>changes</b> you'd make, and the lines
      you'd ride, and those lines light up on the map. Tap an earlier guess to see its lines again. When the game ends, every journey is drawn.</p>
    <p>Hints cost points from 100. Unused guesses add 10 each. A new daily station appears at midnight, Melbourne time.</p>
    <p><b>Hard</b> (choose before your first guess): no station names, guesses don't tell you which lines you'd ride, and you guess by typing a name. In return you get {HARD_MAX_GUESSES} guesses; hints cost double. Your choice carries over to new games.</p>
    <p>Keyboard: Tab to the map, then the arrow keys follow the tracks; Enter opens a stop.</p>
    <h3>About</h3>
    <p class="small">Built from official open data: GTFS Schedule and Vicmap Admin, Department of Transport and
      Planning (Victoria), CC BY 4.0. Fare zones from Metro Trains station pages. Station facts from Wikipedia,
      in our own words. Your games and streak are kept only in this browser and are never sent anywhere. The street map is
      drawn from OpenFreeMap's tile servers (map data © OpenStreetMap contributors), which see your
      IP address like any website; the Diagram view loads nothing from them.
      Stops Away is an independent fan project, not affiliated with Metro Trains, PTV or the Victorian Government.</p>
    <label class="sound"><input type="checkbox" checked={sound} onchange={(e) => setSound(e.currentTarget.checked)} />
      Sound: a soft rising note for warmer, falling for colder, a chime when you find it</label>
    <p class="soundtest"><button type="button" onclick={testSound}>Test sound</button>
      <span class="audiostate">Audio: {audioNow === 'running' ? 'running' : audioNow === 'waiting' ? 'waiting for a tap' : audioNow === 'unavailable' ? 'not supported in this browser' : 'not started yet'}</span></p>
    <form method="dialog"><button class="primary">Got it</button></form>
  </dialog>

  <p class="sr-only" aria-live="polite">{announce}</p>
  {#if hardNote}<p class="hardnote" role="status">{hardNote}</p>{/if}
  {#if toast.length}
    <div class="toast" role="status">
      {#each toast as b (b.id)}<p><span class="medal" aria-hidden="true"></span><b>{b.name}</b> · {b.text}</p>{/each}
    </div>
  {/if}

  <footer class="credit">Data: GTFS Schedule and Vicmap Admin, Department of Transport and Planning (Victoria), CC BY 4.0 · fare zones: Metro Trains · station facts: Wikipedia</footer>
</div>

<style>
  .app { height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr auto auto; }
  .top { display: flex; align-items: center; gap: 8px 10px; padding: 8px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; min-width: 0; }
  .meta { color: var(--muted); font-size: 13px; }
  nav { margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 14px; }
  nav button { padding: 6px 12px; }
  .modesel { font-weight: 700; border-color: var(--accent); color: var(--accent); }
  /* Labels / Hard: pill switches. The real checkbox stays (keyboard, screen readers) but is drawn as a knob. */
  .switch { --on: var(--accent); position: relative; display: inline-flex; align-items: center; gap: 7px; min-height: 36px; box-sizing: border-box;
            padding: 0 12px 0 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface);
            font-weight: 600; color: var(--muted); cursor: pointer; user-select: none; transition: border-color 150ms, background 150ms, color 150ms; }
  .switch.hard { --on: var(--warmer); }
  .switch input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: inherit; }
  .knob { position: relative; width: 26px; height: 16px; border-radius: 8px; background: var(--line); flex: none; transition: background 150ms; }
  .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
                 background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / 0.25); transition: transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .switch:hover { border-color: var(--muted); }
  .switch:has(input:checked) { color: var(--on); border-color: var(--on); background: color-mix(in srgb, var(--on) 9%, var(--surface)); }
  .switch:has(input:checked) .knob { background: var(--on); }
  .switch:has(input:checked) .knob::after { transform: translateX(10px); }
  .switch:has(input:focus-visible) { outline: 3px solid var(--accent); outline-offset: 2px; }
  .switch:has(input:disabled) { opacity: 0.5; cursor: default; }
  .switch:has(input:disabled):hover { border-color: var(--line); }
  @media (prefers-reduced-motion: reduce) { .switch, .knob, .knob::after { transition: none; } }
  @media (max-width: 440px) {
    /* phones: keep the mode buttons and toggles on one row */
    nav { gap: 4px; font-size: 13px; }
    nav button { padding: 6px 9px; }
    .switch { gap: 5px; padding: 0 9px 0 6px; min-height: 34px; }
    .knob { width: 22px; height: 14px; }
    .knob::after { width: 10px; height: 10px; }
    .switch:has(input:checked) .knob::after { transform: translateX(8px); }
  }
  .map-wrap { position: relative; min-height: 0; }
  .legend { position: absolute; left: 8px; bottom: 26px; z-index: 1; max-width: min(320px, calc(100% - 70px));
            background: var(--surface); border: 1px solid var(--line); border-radius: 12px; font-size: 13px; }
  .legend summary { cursor: pointer; padding: 8px 12px; font-weight: 600; }
  .legend ul { list-style: none; margin: 0; padding: 0 12px 10px; display: grid; gap: 5px; }
  .legend li { display: grid; grid-template-columns: 22px 1fr; align-items: center; gap: 8px; line-height: 1.3; }
  .swatch { height: 6px; border-radius: 3px; background: var(--c); }
  .mapmode { position: absolute; left: 8px; top: 8px; z-index: 1; display: flex; padding: 3px; gap: 2px;
             background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
  .mapmode button { border: 0; padding: 8px 12px; min-height: 38px; font-size: 14px; border-radius: 9px; background: none; color: var(--muted); }
  .mapmode button[aria-pressed='true'] { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--fg); font-weight: 600; }
  .credit { font-size: 11px; color: var(--muted); padding: 4px 16px 6px; overflow-wrap: anywhere; }
  .panel { display: grid; gap: 10px; padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
           border-top: 1px solid var(--line); background: var(--bg); max-height: 45dvh; overflow: auto; align-content: safe end; } /* safe: overflow at the top stays scrollable */

  .card { position: absolute; left: 16px; right: 16px; bottom: 16px; max-width: 360px; margin: 0 auto;
          background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px;
          box-shadow: 0 10px 30px rgb(0 0 0 / 0.2); display: grid; gap: 10px; }
  .card-head { display: flex; justify-content: space-between; align-items: center; font-size: 18px; }
  .x { border: 0; background: none; font-size: 22px; padding: 0 6px; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; }
  .chip { padding: 2px 10px 2px 7px; border-radius: 99px; display: inline-flex; align-items: center; gap: 6px;
          background: color-mix(in srgb, var(--c) 14%, transparent); }
  .chip::before { content: ''; width: 9px; height: 9px; border-radius: 50%; background: var(--c); }
  .zone { color: var(--muted); }
  .gone { display: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  .connect { background: var(--surface); border-radius: 12px; padding: 12px; display: grid; gap: 4px; }
  .connect p { margin: 0; }
  .connect .route { font-size: 17px; }
  .connect .sub { color: var(--muted); font-size: 14px; }
  .badges { list-style: none; margin: 8px 0 4px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
  .badges li { padding: 8px 10px; border-radius: 10px; border: 1px dashed var(--line); color: var(--muted); font-size: 12px; display: grid; gap: 2px; }
  .badges li b { font-size: 13px; }
  .badges li.earned { border: 1px solid #e8b931; background: color-mix(in srgb, #e8b931 14%, transparent); color: var(--fg); }
  .soundtest { display: flex; align-items: center; gap: 10px; margin: 6px 0 12px; }
  .soundtest button { font-size: 14px; padding: 6px 12px; }
  .audiostate { font-size: 13px; color: var(--muted); }
  .hardnote { position: fixed; right: 16px; top: 60px; z-index: 20; margin: 0; max-width: min(320px, calc(100vw - 32px));
              padding: 10px 14px; border-radius: 10px; background: var(--fg); color: var(--bg); font-size: 14px;
              box-shadow: 0 8px 24px rgb(0 0 0 / 0.18); animation: toast-in 380ms cubic-bezier(0.16, 1, 0.3, 1); }
  @media (prefers-reduced-motion: reduce) { .hardnote { animation: none; } }
  .toast { position: fixed; left: 50%; top: 64px; transform: translateX(-50%); z-index: 20; display: grid; gap: 6px;
           animation: toast-in 380ms cubic-bezier(0.16, 1, 0.3, 1); }
  .toast p { margin: 0; padding: 10px 14px; border-radius: 12px; background: var(--surface); border: 1px solid #e8b931;
             box-shadow: 0 8px 24px rgb(0 0 0 / 0.16); font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .medal { width: 14px; height: 14px; border-radius: 50%; background: #e8b931; box-shadow: inset 0 0 0 3px #f6d873; flex: none; }
  @keyframes toast-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translateX(-50%); } }
  @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
  .progress { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 6px; font-size: 13px; }
  .progress li { display: grid; grid-template-columns: 1fr 1.4fr auto; gap: 8px; align-items: center; }
  .bar { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--c) 18%, transparent); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--c); }
  .pnum { color: var(--muted); font-variant-numeric: tabular-nums; }
  .theme { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
  .theme span { font-weight: 600; letter-spacing: 0.02em; }
  .theme select { flex: 1; }
  .linebadge { display: inline-block; width: 22px; height: 8px; border-radius: 4px; background: var(--c); margin-right: 8px; vertical-align: middle; }
  .clock { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--fg); }
  .clock.low { color: var(--warmer); }
  .connect label.sub { display: flex; align-items: center; gap: 10px; }
  .connect select { flex: 1; }
  .trend { font-weight: 700; font-size: 15px; }
  .trend.closer { color: var(--warmer); } .trend.further { color: var(--colder); } .trend.same { color: var(--muted); }
  .pickline { display: flex; align-items: center; gap: 10px; }
  .pickline span { font-weight: 600; }
  .pickline select { flex: 1; }
  .runready .primary { justify-self: start; padding: 10px 28px; }
  .route:has(.runcount) { display: flex; align-items: center; gap: 8px; }
  .runcount { margin-left: auto; font-size: 15px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .runcount b { color: var(--fg); font-size: 18px; }
  .runbar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .runbar span { display: block; height: 100%; background: var(--c); transition: width 250ms linear; }
  .runclock { display: flex; align-items: center; gap: 6px; }
  .giveup { margin-left: auto; font-size: 13px; padding: 5px 12px; }
  .runmsg { margin: 0; font-weight: 700; font-size: 15px; animation: runpop 220ms ease-out; }
  .runmsg.ok { color: color-mix(in srgb, var(--hit) 72%, var(--fg)); } .runmsg.bad { color: var(--warmer); }
  @keyframes runpop { from { transform: translateY(3px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .runmsg { animation: none; } .runbar span { transition: none; } }
  .missed { font-size: 14px; color: var(--muted); }
  .cardnote { margin: 4px 0 0; font-size: 14px; color: var(--muted); }
  .whichway { justify-self: start; font-size: 13px; padding: 6px 12px; display: inline-flex; gap: 8px; }
  .whichway span { color: var(--muted); }
  .stars { font-size: 26px; letter-spacing: 0.1em; color: #e0a91a; margin: 2px 0 6px !important; }
  .stars span { color: var(--line); }
  .connect .warn { color: var(--warmer); font-size: 14px; font-weight: 600; }
  .result { background: var(--surface); border-radius: 12px; padding: 12px; animation: slide-up 420ms cubic-bezier(0.2, 0.9, 0.3, 1); }
  @keyframes slide-up { from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .result { animation: none; } }
  .result p { margin: 0 0 6px; font-weight: 600; }
  .result pre { margin: 0 0 10px; font-family: inherit; white-space: pre-wrap; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .verdict { font-size: 18px; }
  .duelintro { margin: 0; padding: 10px 12px; border-radius: 12px; font-size: 14px; line-height: 1.4;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
  .verdict.win { color: var(--hit); } .verdict.lose { color: var(--warmer); }
  .fact { font-weight: 400 !important; font-size: 14px; }
  .fact a { color: var(--accent); margin-left: 4px; }
  .stats { font-weight: 400 !important; color: var(--muted); font-size: 13px; }
  .help { max-width: 420px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--fg); padding: 18px 20px; }
  .help::backdrop { background: rgb(0 0 0 / 0.4); }
  .help .sound { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; margin: 4px 0 12px; }
  .help h2 { margin: 0 0 8px; font-size: 18px; }
  .help p { margin: 0 0 10px; font-size: 15px; }
  .help h3 { margin: 14px 0 4px; font-size: 15px; }
  .help .small { font-size: 13px; color: var(--muted); }

  @media (min-width: 900px) {
    .app { grid-template-columns: 1fr 380px; grid-template-rows: auto 1fr auto; }
    .credit { grid-column: 1 / -1; }
    .top { grid-column: 1 / -1; }
    .panel { border-top: 0; border-left: 1px solid var(--line); max-height: none; align-content: start;
             grid-auto-rows: max-content; }
    .panel :global(.guess) { order: -1; }
    .panel :global(.guess ul) { bottom: auto; top: calc(100% + 6px); }
    .card { left: 24px; right: auto; bottom: 24px; width: 320px; }
  }
</style>
