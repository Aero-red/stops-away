// Runs the automatable cases of ../../TEST_PLAN.md in headless Chrome and checks what the
// page shows against the real engine. No dependencies beyond Chrome and this app.
//
//   npm run dev                       (in another terminal)
//   NODE_OPTIONS=--experimental-websocket npx vite-node e2e/run-plan.ts [url]
//
// CHROME=/path/to/chrome overrides the browser. Manual-only cases are listed at the end.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import network from '../src/data/network.json';
import type { Network } from '../src/engine/types';
import { dayNumber, pickTarget } from '../src/engine/daily';
import { shortestRoute } from '../src/engine/route';
import { neighbours } from '../src/engine/connect';
import { lineStations } from '../src/engine/linerun';
import { duelDecode, duelEncode } from '../src/engine/duel';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEED = 20260101;
const net = network as Network;
const byName = (n: string) => net.stations.find((s) => s.name === n)!;
const nameOf = (id: string) => net.stations.find((s) => s.id === id)!.name;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- results
const results: { id: string; ok: boolean; note: string }[] = [];
function check(id: string, ok: boolean, note: string) {
  results.push({ id, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id.padEnd(4)} ${note}`);
}

// ---------- a tiny CDP client
const profile = mkdtempSync(join(tmpdir(), 'stops-away-e2e-'));
const PORT = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); } }

type Opts = { clockMs?: number; blockStorage?: boolean; scheme?: 'light' | 'dark'; reduceMotion?: boolean; phone?: boolean; webgl?: boolean };
async function openPage(o: Opts = {}) {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const pending = new Map<number, (v: any) => void>();
  const errors: string[] = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description ?? ''));
    if (d.id && pending.has(d.id)) { pending.get(d.id)!(d); pending.delete(d.id); }
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>((r) => { pending.set(++n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (expr: string) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`evaluate failed: ${expr.slice(0, 80)}: ${r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', o.phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1200, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: o.scheme ?? 'light' },
    { name: 'prefers-reduced-motion', value: o.reduceMotion ? 'reduce' : 'no-preference' }] });
  if (o.clockMs !== undefined) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `{
      const Real = Date; let shift = ${o.clockMs} - Real.now();
      window.__jump = (ms) => { shift += ms; };
      globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [Real.now() + shift])); } static now() { return Real.now() + shift; } }; }` });
  }
  if (o.blockStorage) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });` });
  }
  // wait until the game is on screen, not a fixed time (software WebGL makes loads vary)
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      const r = await send('Runtime.evaluate', { expression: `!!document.querySelector('.panel') && document.querySelectorAll('g.stop').length === 226`, returnByValue: true });
      if (r.result?.result?.value) return;
      await sleep(150);
    }
    throw new Error('page never became ready');
  };
  const go = async () => { await send('Page.navigate', { url: URL }); await sleep(300); await ready(); };
  const reload = async () => { await send('Page.reload'); await sleep(300); await ready(); };
  const key = async (k: string, code = k, vk = 0) => {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
    await sleep(120);
  };
  const typeIn = async (text: string) => {
    await ev(`(() => { const i = document.querySelector('input[role=combobox]'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
    await send('Input.insertText', { text });
    await sleep(250);
  };
  const enter = () => key('Enter', 'Enter', 13);
  const guessByTyping = async (name: string) => { await typeIn(name); await enter(); await sleep(700); };
  const text = (sel: string) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const options = () => ev(`[...document.querySelectorAll('[role=option]')].map(o => o.textContent.trim())`);
  const guesses = async () => Number(((await text('.history header')) ?? '').match(/Guesses (\d+)/)?.[1] ?? -1);
  const clickStop = (name: string) => ev(`document.querySelector('g.stop[aria-label^=${JSON.stringify(name)}]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  const clickButton = (label: string, scope = 'document') =>
    ev(`[...${scope}.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(label)}))?.click()`);
  // pick a mode from the header's Mode menu
  const mode = async (label: string) => {
    await ev(`(() => { const sel = document.querySelector('select.modesel'); const o = [...sel.options].find(o => o.textContent.startsWith(${JSON.stringify(label)}));
      sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(300);
  };
  const close = async () => { ws.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`); }; // close the tab, not just the socket
  const goTo = async (u: string) => { await send('Page.navigate', { url: u }); await sleep(300); await ready(); };
  return { send, ev, go, goTo, reload, mode, key, typeIn, enter, guessByTyping, text, options, guesses, clickStop, clickButton, errors, close };
}
// a fresh site; the Daily starts in Hard (user, 2026-11-21), but most checks read the Easy Daily's
// lines and chips, so they get a player who switched the Daily to Easy. DAILYHARD checks the real default.
const clearSite = async (p: Awaited<ReturnType<typeof openPage>>, { dailyEasy = true } = {}) => {
  await p.send('Storage.clearDataForOrigin', { origin: new globalThis.URL(URL).origin, storageTypes: 'all' });
  if (dailyEasy) await p.ev(`localStorage.setItem('chug:hard:daily', 'false')`);
};

// ---------- the day under test, and guesses chosen from the engine so cases never hit the target by luck
const today = dayNumber(new Date());
const target = pickTarget(today, SEED, net.stations);
const routeTo = (id: string) => shortestRoute(net, id, target.id)!;
const pick = (want: (r: ReturnType<typeof routeTo>) => boolean, avoid: string[]) =>
  net.stations.find((s) => s.id !== target.id && !avoid.includes(s.name) && want(routeTo(s.id)))!;
const RESERVED = ['Flinders Street', 'Albion', 'Frankston', 'Southern Cross', 'Glen Huntly', 'Jolimont-MCG'];
console.log(`day #${today}; target ${target.name} (from the engine)\n`);

// ================= A, B, C, D, E, K, L1 on today's daily (light)
{
  const p = await openPage({ scheme: 'light' });
  await p.go(); await clearSite(p); await p.reload();
  const top = await p.text('.top');
  check('A1', top?.includes('Stops Away') && top.includes(`#${today}`) && top.includes('🔥 0')
    && (await p.ev(`document.querySelectorAll('g.stop').length`)) === 226 && (await p.guesses()) === 0
    && (await p.ev(`document.querySelector('.shop .toggle')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)) === 'Hints · 100 pts left',
    `header "${top?.replace(/\n/g, ' ')}"; 226 stops; 0 guesses; 100 pts`);

  await p.typeIn('FSS');
  check('B2', (await p.options())[0] === 'Flinders Street', `"FSS" → ${JSON.stringify((await p.options()).slice(0, 2))}`);
  await p.typeIn('jolimont');
  check('B3', (await p.options())[0] === 'Jolimont-MCG', `"jolimont" → ${JSON.stringify(await p.options())}`);
  await p.typeIn('sydney');
  const before = await p.guesses();
  await p.enter(); await sleep(300);
  check('B4', (await p.options()).length === 0 && (await p.guesses()) === before && p.errors.length === 0, '"sydney": no list, Enter does nothing, no errors');
  await p.typeIn('station');
  const st = await p.options();
  await p.typeIn('glen huntly station');
  check('B6', (await p.options())[0] === 'Glen Huntly' && p.errors.length === 0, `"station" → ${st.length} options; "glen huntly station" → ${(await p.options())[0]}`);

  if (target.name !== 'Flinders Street') {
    await p.typeIn('flind');
    const first = (await p.options())[0];
    await p.enter(); await sleep(700);
    const row = await p.text('.history ol li');
    const r = routeTo(byName('Flinders Street').id);
    check('B1', first === 'Flinders Street' && !!row?.includes('Flinders Street') && !!row?.includes(`${r.stops} stops`),
      `"flind" → ${first}; row "${row?.replace(/\n/g, ' ')}"; engine says ${r.stops} stops, ${r.changes} changes`);
    await p.typeIn('flinders');
    check('B5', !(await p.options()).includes('Flinders Street'), 'a guessed station is not offered again');
  }

  // C: stop cards (zones), closing without guessing, then a tap guess
  const zoneOf = async (n: string) => { await p.clickStop(n); await sleep(200); const t = await p.text('[role=dialog].card'); await p.key('Escape', 'Escape', 27); return t; };
  const [za, zf, zs] = [await zoneOf('Albion'), await zoneOf('Frankston'), await zoneOf('Flinders Street')];
  check('C4', !!za?.includes('Zone 1/2') && !!zf?.includes('Zone 2') && !!zs?.includes('Zone 1') && !zs?.includes('Zone 1/2'),
    `Albion / Frankston / Flinders Street → ${[za, zf, zs].map((t) => t?.match(/Zone [\d/]+/)?.[0]).join(', ')}`);
  const g0 = await p.guesses();
  await p.clickStop('Albion'); await sleep(150);
  await p.ev(`document.querySelector('svg.map').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(150);
  const c1 = !(await p.ev(`!!document.querySelector('[role=dialog].card')`));
  await p.clickStop('Albion'); await sleep(150); await p.ev(`document.querySelector('.card .x').click()`); await sleep(150);
  const c2 = !(await p.ev(`!!document.querySelector('[role=dialog].card')`));
  await p.clickStop('Albion'); await sleep(150); await p.key('Escape', 'Escape', 27);
  const c3 = !(await p.ev(`!!document.querySelector('[role=dialog].card')`));
  check('C3', c1 && c2 && c3 && (await p.guesses()) === g0, `closed by empty map ${c1}, × ${c2}, Escape ${c3}; no guess made`);
  await p.clickStop('Albion'); await sleep(200);
  const card = await p.text('[role=dialog].card');
  // tap-to-guess is a Practice aid only (user, 2026-11-21): the Daily card names the stop but has no guess button
  const dailyBtn = await p.ev(`document.querySelector('.card .primary')?.textContent.trim() ?? null`);
  check('C1', !!card?.includes('Albion') && dailyBtn === null && !!card?.includes('Type its name to guess') && (await p.ev(`document.querySelectorAll('.card .chip').length`)) > 0,
    `daily card "${card?.replace(/\n/g, ' | ')}"; guess button ${JSON.stringify(dailyBtn)}`);
  await p.key('Escape', 'Escape', 27); await sleep(150);
  await p.mode('Practice'); await sleep(300);
  await p.clickStop('Albion'); await sleep(200);
  await p.clickButton('Guess this', `document.querySelector('.card')`); await sleep(700);
  const dot = await p.ev(`document.querySelector('g.stop[aria-label^="Albion"] text.count')?.textContent`);
  const practiceGuesses = await p.guesses();
  await p.mode('Daily'); await sleep(300);
  check('C2', practiceGuesses === 1 && dot !== undefined && dot !== null && (await p.guesses()) === g0,
    `Practice: Guess this landed (${practiceGuesses} guess, dot ${dot}); Daily untouched (${await p.guesses()} = ${g0})`);

  // D: on-screen numbers equal the engine's, for a 0-change and a 1-change guess
  const used = [...RESERVED];
  for (const [id, changes] of [['D1', 0], ['D2', 1]] as const) {
    const s = pick((r) => r.changes === changes && r.stops > 2, used);
    used.push(s.name);
    await p.guessByTyping(s.name);
    const row = (await p.text('.history ol li')) ?? '';
    const r = routeTo(s.id);
    const want = `${r.stops} stops · ${r.changes} ${r.changes === 1 ? 'change' : 'changes'}`;
    const pulses = await p.ev(`document.querySelectorAll('.route .pulse').length`);
    // no change-point pulse mid-game: where you'd change is more than the history text says
    check(id, row.includes(s.name) && row.includes(want) && pulses === 0,
      `${s.name} → screen "${row.replace(/\n/g, ' ')}"; engine "${want}"; change points shown mid-game: ${pulses}`);
  }
  // FEED: the newest guess gets a short warmer/colder word on the map
  const callout = await p.ev(`document.querySelector('.callout text')?.textContent ?? null`);
  check('FEED', !!callout && /^(Warmer|Colder|Same) · \d+ stops$|^\d+ stops away$/.test(callout), `callout after the guess: "${callout}"`);
  // HIST: tapping an older history row lights that guess's lines and moves the map
  await p.ev(`document.querySelector('.history header button')?.click()`); await sleep(150); // show all rows
  const vbBefore = await p.ev(`document.querySelector('svg.map').getAttribute('viewBox')`);
  await p.ev(`[...document.querySelectorAll('.history .row')].at(-1).click()`); await sleep(900);
  const rowLines = (await p.ev(`[...[...document.querySelectorAll('.history .row')].at(-1).querySelectorAll('.chip')].map(c => c.dataset.line)`)) as string[];
  const litNow = (await p.ev(`[...new Set([...document.querySelectorAll('.tracks .on')].map(l => l.dataset.line))].sort()`)) as string[];
  const vbAfter = await p.ev(`document.querySelector('svg.map').getAttribute('viewBox')`);
  check('HIST', JSON.stringify(litNow) === JSON.stringify([...new Set(rowLines)].sort()) && vbAfter !== vbBefore
    && (await p.ev(`[...document.querySelectorAll('.history .row')].at(-1).getAttribute('aria-pressed')`)) === 'true',
    `tapping the first guess lights ${JSON.stringify(litNow)} (row says ${JSON.stringify(rowLines)}) and moves the map`);
  await p.ev(`[...document.querySelectorAll('.history .row')][0].click()`); await sleep(300); // back to the latest
  const live = await p.text('[aria-live=polite]');
  check('K1', /: \d+ stops away, \d+ changes?, .+\. \d+ guesse?s? left\.$/.test(live ?? ''), `live region "${live}" (a real screen reader is still a manual check)`);
  check('K2', (await p.ev(`document.querySelector('input[role=combobox]').getAttribute('aria-label')`)) === 'Guess a station', 'combobox named "Guess a station"');

  // L1: light theme, warmth dot numbers readable (white on warmer/colder, #111 on neutral)
  const far = pick((r) => r.stops > 30, used);
  used.push(far.name);
  await p.guessByTyping(far.name); // worse than the best so far: colder
  const fills = await p.ev(`Object.fromEntries([...document.querySelectorAll('text.count')].map(t => [t.classList[1], getComputedStyle(t).fill]))`);
  check('L1', fills.colder === 'rgb(255, 255, 255)' && (!fills.first || fills.first === 'rgb(17, 17, 17)'), `light dot numbers ${JSON.stringify(fills)}`);
  // the map must not draw any route mid-game: every route ends at the hidden station
  const drawn = await p.ev(`document.querySelectorAll('.route polyline, .ghosts polyline').length`);
  const litNames = (await p.ev(`[...new Set([...document.querySelectorAll('.tracks .on')].map(l => l.dataset.line))].sort()`)) as string[];
  const chipNames = (await p.ev(`[...document.querySelector('.history ol li').querySelectorAll('.chip')].map(c => c.dataset.line)`)) as string[];
  check('SPOIL', drawn === 0 && JSON.stringify(litNames) === JSON.stringify([...new Set(chipNames)].sort()),
    `mid-game: ${drawn} route lines drawn; lit lines ${JSON.stringify(litNames)} = history row ${JSON.stringify(chipNames)}`);

  // E: hints
  await p.clickButton('Hints');
  await sleep(150);
  const shop = (await p.ev(`[...document.querySelectorAll('.shop .grid button')].map(b => b.innerText.replace(/\\n/g, ' '))`)) as string[];
  check('E1', JSON.stringify(shop) === JSON.stringify(['Fare zone −10', 'A line −20', 'Council −25', 'First letter −30', 'Area −40']), JSON.stringify(shop));
  const buy = async (label: string) => { await p.ev(`[...document.querySelectorAll('.shop .grid button')].find(b => b.innerText.startsWith(${JSON.stringify(label)})).click()`); await sleep(200); };
  for (const h of ['Fare zone', 'A line', 'Council', 'First letter']) await buy(h);
  const bought = (await p.ev(`[...document.querySelectorAll('.shop .bought li')].map(l => l.textContent)`)) as string[];
  const okText = /^Zone (1|2|1\/2 \(the overlap\))$/.test(bought[0]) && bought[1].startsWith('One line through it: ')
    && bought[2].startsWith('Council area: ') && bought[3] === `Starts with "${target.name[0]}"`;
  check('E2', okText, JSON.stringify(bought) + ' (Area checked by E3 being unaffordable here; its wording is in hints.test.ts)');
  const areaDisabled = await p.ev(`[...document.querySelectorAll('.shop .grid button')].find(b => b.innerText.startsWith('Area')).disabled`);
  check('E3', areaDisabled === true && (await p.ev(`document.querySelector('.shop .toggle')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)) === 'Hints · 15 pts left', `15 pts left; Area disabled ${areaDisabled}`);
  const twice = await p.ev(`(() => { const b = [...document.querySelectorAll('.shop .grid button')].find(b => b.innerText.startsWith('Fare zone')); return [b.disabled, b.innerText.includes('bought')]; })()`);
  check('E6', JSON.stringify(twice) === '[true,true]', `a bought hint: disabled ${twice[0]}, says "bought" ${twice[1]}`);

  // win, then E4 / K3 / K1 win announcement / G2 first half
  await p.guessByTyping(target.name);
  const status = await p.text('.result[role=status]');
  check('E4', (await p.ev(`!!document.querySelector('.shop')`)) === false, 'hint shop gone after the game ends');
  // WIN: a celebration at the found station: ripples, a burst of rays in its lines' colours, journeys drawing in
  const win = await p.ev(`(() => { const w = document.querySelector('.win'); if (!w) return null;
    return [w.querySelectorAll('.ripple').length, w.querySelectorAll('.ray').length,
      new Set([...w.querySelectorAll('.ray')].map(r => r.getAttribute('stroke'))).size,
      document.querySelectorAll('.ghosts polyline.drawin').length, getComputedStyle(w.querySelector('.ripple')).animationName]; })()`);
  check('WIN', !!win && win[0] === 3 && win[1] >= 12 && win[2] >= 1 && win[4] !== 'none',
    `found it: ${win ? `${win[0]} ripples, ${win[1]} rays in ${win[2]} line colour(s), ${win[3]} journeys drawing in, animation "${win[4]}"` : 'no celebration'}`);
  // END: only the journeys between the guesses and the answer stand out
  await p.ev(`(() => { const b = document.querySelector('.history header button'); if (b && b.textContent.startsWith('Show all')) b.click(); })()`); await sleep(150);
  const end = await p.ev(`[document.querySelectorAll('.tracks > *:not(.faint)').length,
    [...document.querySelectorAll('g.stop:not(.off)')].map(g => g.id.slice(5)).sort()]`);
  const guessedIds = ((await p.ev(`[...document.querySelectorAll('.history .row .name')].map(n => n.textContent)`)) as string[]).map((n) => byName(n).id);
  const journey = [...new Set(guessedIds.flatMap((id) => shortestRoute(net, id, target.id)!.path))].sort();
  check('END', end[0] === 0 && JSON.stringify(end[1]) === JSON.stringify(journey),
    `after the win: ${end[0]} tracks not faded; ${end[1].length} stops shown = the ${journey.length} on the journeys from ${guessedIds.length} guesses`);
  const ghostsAfter = await p.ev(`document.querySelectorAll('.ghosts polyline').length`);
  const boldAfter = await p.ev(`document.querySelectorAll('.route polyline').length > 0 ? 1 : 0`);
  check('MAP1', ghostsAfter + boldAfter === (await p.guesses()) - 1, `after the win every earlier guess's journey is drawn: ${ghostsAfter} faint + ${boldAfter} bold`);
  check('K3', !!status?.startsWith('Solved in'), `result "${status?.split('\n')[0]}" in role=status`);
  check('K1+', /correct, solved in \d+\.$/.test((await p.text('[aria-live=polite]')) ?? ''), `win announced: "${await p.text('[aria-live=polite]')}"`);
  check('G2a', !!status?.includes('Played 1 · Won 1 · Streak 1'), (status ?? '').split('\n').find((l) => l.startsWith('Played')) ?? 'no stats line');

  // A2 / A3: practice and back
  const n = await p.guesses();
  await p.mode('Practice'); await sleep(300);
  const a2 = (await p.text('.top'))?.includes('Practice') && (await p.guesses()) === 0 && (await p.text('.top'))?.includes('🔥 1');
  await p.reload();
  const backToDaily = (await p.text('.top'))?.includes(`#${today}`);
  check('A2', !!a2 && !!backToDaily, `Practice resets, streak unchanged (🔥 1), reload returns to Daily ${backToDaily}`);
  await p.mode('Practice'); await sleep(200); await p.mode('Daily'); await sleep(300);
  check('A3', (await p.guesses()) === n, `Daily comes back with ${await p.guesses()} guesses (was ${n})`);
  check('ERR', p.errors.length === 0, `no page errors (${p.errors.length})`);
  await p.close();
}

// ================= F, E5, G1, G2 second half: tomorrow, Hard mode, dark theme, same browser storage
{
  const tomorrowMs = Date.now() + 86_400_000;
  const t2 = dayNumber(new Date(tomorrowMs));
  const target2 = pickTarget(t2, SEED, net.stations);
  const p = await openPage({ clockMs: tomorrowMs, scheme: 'dark' });
  await p.go();
  check('G2b', !!(await p.text('.top'))?.includes('🔥 1') && !!(await p.text('.top'))?.includes(`#${t2}`), `tomorrow (#${t2}) before playing: ${(await p.text('.top'))?.replace(/\n/g, ' ')}`);
  const hardBox = `[...document.querySelectorAll('nav label')].find(l => l.textContent.includes('Hard')).querySelector('input')`;
  await p.ev(`${hardBox}.click()`); await sleep(200);
  const grey = await p.ev(`getComputedStyle(document.querySelector('.tracks line')).stroke`);
  // Hard keeps the line colours (user, 2026-11-19); it hides names and doubles hint costs
  check('F1', (await p.ev(`${hardBox}.checked`)) && (await p.ev(`document.querySelectorAll('text.label').length`)) === 0 && grey !== 'rgb(93, 101, 108)',
    `Hard ticked; 0 names; tracks keep their colour (${grey})`);
  await p.clickButton('Hints'); await sleep(150);
  await p.ev(`[...document.querySelectorAll('.shop .grid button')].find(b => b.innerText.startsWith('Fare zone')).click()`); await sleep(200);
  check('E5', (await p.ev(`document.querySelector('.shop .toggle')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)) === 'Hints · 80 pts left', `Hard: fare zone costs 20 → ${await p.ev(`document.querySelector('.shop .toggle')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)}`);
  const unguessed = net.stations.find((s) => s.id !== target2.id && s.name !== 'Flinders Street')!;
  await p.ev(`document.getElementById('stop-${unguessed.id}').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(200);
  const hcard = (await p.text('[role=dialog].card')) ?? '';
  check('F4', hcard.startsWith('This stop') && !hcard.includes(unguessed.name) && (await p.ev(`document.querySelectorAll('.card .chip').length`)) === 0, `card "${hcard.replace(/\n/g, ' | ')}"`);
  await p.key('Escape', 'Escape', 27);
  const w1 = net.stations.find((s) => s.id !== target2.id && s.name === 'Southern Cross') ?? net.stations.find((s) => s.id !== target2.id)!;
  const w2 = pick(() => true, [w1.name, target2.name]);
  await p.guessByTyping(w1.name);
  // HARD: no lines told anywhere, and 12 guesses
  const hardInfo = await p.ev(`[document.querySelectorAll('.history .chip').length, document.querySelectorAll('.tracks .on').length,
    document.querySelector('[aria-live=polite]').textContent, document.querySelector('.history header').textContent]`);
  const lineNames = (await p.ev(`[...new Set([...document.querySelectorAll('[data-line]')].map(x => x.dataset.line))]`)) as string[];
  const names = net.lines.map((l) => l.name);
  const spoken = hardInfo[2] as string;
  check('HARD', hardInfo[0] === 0 && hardInfo[1] === 0 && !names.some((n) => spoken.includes(n + ' then') || spoken.includes(', ' + n + '.'))
    && /\/12/.test(hardInfo[3]), `Hard: ${hardInfo[0]} line chips, ${hardInfo[1]} lit lines, spoken "${spoken}", counter "${(hardInfo[3] as string).trim().split(/\s{2,}/)[0]}"`);
  void lineNames;
  // the box stays live after a guess (user, 2026-11-19: "greyed out, can't change"); raising Easy to Hard mid-game is refused with a note (HARD2)
  const locked = await p.ev(`[${hardBox}.disabled, ${hardBox}.checked]`);
  check('F2', locked[0] === false && locked[1] === true, `after a guess in Hard: disabled ${locked[0]}, checked ${locked[1]}`);
  if (w2.id !== target2.id) await p.guessByTyping(w2.name);
  const darkFill = await p.ev(`[...document.querySelectorAll('text.count.first')].map(t => getComputedStyle(t).fill)[0] ?? null`);
  check('L2', darkFill === 'rgb(255, 255, 255)', `dark: neutral dot number fill ${darkFill} (white on grey)`);
  const g = await p.guesses();
  await p.reload();
  check('G1', (await p.guesses()) === g && (await p.ev(`${hardBox}.checked`)) && (await p.ev(`document.querySelector('.shop .toggle')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)) === 'Hints · 80 pts left',
    `after reload: ${await p.guesses()} guesses, Hard kept, 80 pts`);
  await p.guessByTyping(target2.name);
  const st = (await p.text('.result[role=status]')) ?? '';
  const share = st.split('\n').find((l) => l.startsWith('Stops Away #')) ?? '';
  check('F3', share.endsWith('· Hard'), `share "${share}"`);
  check('G2c', st.includes('Streak 2') && !!(await p.text('.top'))?.includes('🔥 2'), `after tomorrow's win: ${(st.split('\n').find((l) => l.startsWith('Played')) ?? '')}`);
  await p.close();
}

// ================= G3: storage blocked
{
  const p = await openPage({ blockStorage: true });
  await p.go();
  const s = pick(() => true, [target.name]);
  await p.guessByTyping(s.name);
  check('G3', (await p.guesses()) === 1 && p.errors.length === 0, `played 1 guess with localStorage throwing; page errors ${p.errors.length}${p.errors.length ? ': ' + p.errors[0].slice(0, 160) : ''}`);
  await p.close();
}

// ================= H1-H3: midnight rollover (fresh storage each)
const at2359 = (() => { // 23:59 Melbourne time today
  const now = new Date();
  for (let m = 0; m < 48 * 60; m++) {
    const t = new Date(Math.floor(now.getTime() / 60000) * 60000 + m * 60000);
    const hm = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
    if (hm === '23:59') return t.getTime();
  }
  throw new Error('no 23:59 found');
})();
const dayAt = dayNumber(new Date(at2359));
const tgtAt = pickTarget(dayAt, SEED, net.stations);
for (const [id, mode] of [['H1', 'finished'], ['H2', 'untouched'], ['H3', 'in progress']] as const) {
  const p = await openPage({ clockMs: at2359 });
  await p.go(); await clearSite(p); await p.reload();
  if (mode === 'finished') await p.guessByTyping(tgtAt.name);
  if (mode === 'in progress') await p.guessByTyping(pick(() => true, [tgtAt.name]).name);
  const before = await p.text('.top .meta');
  await p.ev(`window.__jump(120000); document.dispatchEvent(new Event('visibilitychange'))`); await sleep(500);
  const after = await p.text('.top .meta');
  const moved = after === `#${dayAt + 1}`;
  check(id, mode === 'in progress' ? !moved && (await p.guesses()) === 1 : moved && (await p.guesses()) === 0,
    `${mode} at 23:59 (${before}) → 00:01 ${after}, ${await p.guesses()} guesses`);
  await p.close();
}

// ================= J2, J3: keyboard
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.mode('Practice'); await sleep(300); // the card's guess button lives in Practice only
  await p.ev(`document.getElementById('stop-${byName('Richmond').id}').focus()`);
  await p.key('ArrowRight', 'ArrowRight', 39);
  const moved = await p.ev(`document.activeElement.getAttribute('aria-label')`);
  await p.key('Enter', 'Enter', 13); await sleep(200);
  const onBtn = await p.ev(`document.activeElement.textContent.trim()`);
  await p.key('Escape', 'Escape', 27); await sleep(150);
  const back = await p.ev(`document.activeElement.getAttribute('aria-label')`);
  check('J2', moved !== 'Richmond' && !!moved && onBtn === 'Guess this' && back === moved, `→ from Richmond to ${moved}; Enter → "${onBtn}"; Escape → ${back}`);
  await p.typeIn('ber');
  const opts = (await p.options()) as string[];
  await p.key('ArrowDown', 'ArrowDown', 40);
  const ad = await p.ev(`document.querySelector('input[role=combobox]').getAttribute('aria-activedescendant')`);
  const second = opts[1];
  await p.enter(); await sleep(700);
  const row = await p.text('.history ol li');
  check('J3', ad === 'opt-1' && !!row?.startsWith(second) || (second === target.name && !!(await p.text('.result[role=status]'))),
    `"ber" → ${JSON.stringify(opts.slice(0, 3))}; ↓ → ${ad}; Enter guessed "${row?.split('\n')[0]}"`);
  await p.close();
}

// ================= HOME: the map opens on the city, not the whole network (user, 2026-11-19)
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await sleep(700); // let the map make its first fit before measuring
  const seen = await p.ev(`(() => { const r = document.querySelector('svg.map').getBoundingClientRect();
    const on = (n) => { const c = document.querySelector('g.stop[aria-label^="' + n + '"] circle.dot, g.stop[aria-label^="' + n + '"] .stn-tick, g.stop[aria-label^="' + n + '"] .capsule');
      const b = document.querySelector('g.stop[aria-label^="' + n + '"]').getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
      return x > r.left && x < r.right && y > r.top && y < r.bottom; };
    return { fss: on('Flinders Street'), rmd: on('Richmond'), fkn: on('Frankston'), syd: on('Sunbury') }; })()`);
  check('HOME', seen.fss && seen.rmd && !seen.fkn && !seen.syd, `opening view: Flinders Street ${seen.fss}, Richmond ${seen.rmd}, Frankston ${seen.fkn}, Sunbury ${seen.syd}`);
  await p.close();
}

// ================= MAP2, MAP3: real pointer taps at the default zoom
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  const click = async (x: number, y: number) => {
    for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await sleep(300);
  };
  // screen centres of every plain stop, to pick taps that suit whatever layout is drawn
  await p.ev(`document.querySelector('button[aria-label="Show whole map"]').click()`); await sleep(400);
  const dots = (await p.ev(`[...document.querySelectorAll('g.stop')].map(g => { const b = g.querySelector('circle.dot').getBoundingClientRect();
    return [g.getAttribute('aria-label'), b.x + b.width / 2, b.y + b.height / 2]; })`)) as [string, number, number][];
  const nearestOther = (d: [string, number, number]) => Math.min(...dots.filter((o) => o !== d).map((o) => Math.hypot(o[1] - d[1], o[2] - d[2])));
  // MAP2: the most isolated stop, tapped 8 px off centre, away from its nearest neighbour
  const lone = dots.reduce((a, b) => (nearestOther(b) > nearestOther(a) ? b : a));
  const nb = dots.filter((o) => o !== lone).reduce((a, b) => (Math.hypot(b[1] - lone[1], b[2] - lone[2]) < Math.hypot(a[1] - lone[1], a[2] - lone[2]) ? b : a));
  const away = Math.hypot(lone[1] - nb[1], lone[2] - nb[2]);
  await click(lone[1] + ((lone[1] - nb[1]) / away) * 8, lone[2] + ((lone[2] - nb[2]) / away) * 8);
  const card = await p.text('[role=dialog].card');
  check('MAP2', !!card?.startsWith(lone[0]), `tap 8 px off ${lone[0]} (away from ${nb[0]}) opens: ${card?.split('\n')[0]}`);
  await p.key('Escape', 'Escape', 27);
  // MAP3: midway between the two stops closest together on screen
  let pair: [typeof dots[0], typeof dots[0]] = [dots[0], dots[1]];
  for (let a = 0; a < dots.length; a++) for (let b = a + 1; b < dots.length; b++)
    if (Math.hypot(dots[a][1] - dots[b][1], dots[a][2] - dots[b][2]) < Math.hypot(pair[0][1] - pair[1][1], pair[0][2] - pair[1][2])) pair = [dots[a], dots[b]];
  const vb0 = await p.ev(`document.querySelector('svg.map').getAttribute('viewBox')`);
  await click((pair[0][1] + pair[1][1]) / 2, (pair[0][2] + pair[1][2]) / 2);
  const vb1 = await p.ev(`document.querySelector('svg.map').getAttribute('viewBox')`);
  const w0 = Number(vb0.split(' ')[2]), w1 = Number(vb1.split(' ')[2]);
  const opened = await p.ev(`!!document.querySelector('[role=dialog].card')`);
  check('MAP3', w1 < w0 / 2 && !opened, `tap between ${pair[0][0]} and ${pair[1][0]} zooms in (view width ${w0.toFixed(1)} → ${w1.toFixed(1)}) and opens no card`);
  const tabbable = await p.ev(`document.querySelectorAll('g.stop[tabindex="0"]').length`);
  check('MAP4', tabbable === 1, `stops in the tab order: ${tabbable} (roving tabindex)`);
  await p.close();
}

// ================= TOUCH: phone gestures keep the map under your fingers (user, 2026-11-21: "map movement doesn't work properly in mobile")
{
  const p = await openPage({ phone: true });
  await p.go(); await clearSite(p); await p.reload();
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // the map point under a screen point, from the live viewBox
  const under = (x: number, y: number) => p.ev(`(() => { const s = document.querySelector('svg.map'), r = s.getBoundingClientRect(), [vx, vy, vw, vh] = s.getAttribute('viewBox').split(' ').map(Number);
    return [vx + (${x} - r.left) / r.width * vw, vy + (${y} - r.top) / r.height * vh, vw]; })()`) as Promise<number[]>;
  const touch = (type: string, pts: [number, number][], timestamp?: number) =>
    p.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })), ...(timestamp ? { timestamp } : {}) });
  const box = (await p.ev(`(() => { const r = document.querySelector('svg.map').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`)) as number[];
  const cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2;
  const off = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) / a[2] * box[2]; // in screen px
  // one finger: drag 120 px left and 60 px down in small steps
  const g0 = await under(cx, cy);
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', [[cx - 10 * i, cy + 5 * i]]); await sleep(16); }
  await sleep(150); await touch('touchEnd', []); await sleep(200); // held still before lifting: no glide
  const drag = off(g0, await under(cx - 120, cy + 60));
  // pinch: two fingers 80 px apart spread to 240 px apart, about the same middle
  const p0 = await under(cx, cy);
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 16; i++) { await touch('touchMove', [[cx - 40 - 5 * i, cy], [cx + 40 + 5 * i, cy]]); await sleep(16); }
  const p1 = await under(cx, cy);
  // then both fingers move up together by 80 px: the map follows
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - 120, cy - 10 * i], [cx + 120, cy - 10 * i]]); await sleep(16); }
  await touch('touchEnd', []); await sleep(200);
  const p2 = await under(cx, cy - 80);
  const zoom = p0[2] / p1[2];
  // a quick flick: the map keeps gliding the same way after the finger lifts, then stops
  const f0 = await under(cx, cy);
  // stamped 16 ms apart like a real phone's frames: the busy test browser delivers them late, which would read as a slow lift
  const t0 = Date.now() / 1000;
  await touch('touchStart', [[cx, cy]], t0);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 25 * i, cy]], t0 + 0.016 * i);
  await touch('touchEnd', [], t0 + 0.016 * 7);
  const atLift = (await under(cx - 150, cy))[0] - f0[0];
  await sleep(2000);
  const settled = (await under(cx - 150, cy))[0] - f0[0];
  await sleep(300);
  const still = (await under(cx - 150, cy))[0] - f0[0];
  const glidePx = Math.abs(settled - atLift) / p2[2] * box[2];
  check('TOUCH', drag < 3 && off(p0, p1) < 6 && zoom > 2.6 && zoom < 3.4 && off(p0, p2) < 6 && glidePx > 20 && settled > atLift && still === settled,
    `drag: point under the finger is ${drag.toFixed(1)} px off; pinch ×${zoom.toFixed(2)} (want 3), middle ${off(p0, p1).toFixed(1)} px off; two-finger move: ${off(p0, p2).toFixed(1)} px off; flick glided ${glidePx.toFixed(0)} px further and stopped ${still === settled}`);
  await p.close();
}

// ================= MAP5, MAP6: the phone opens on the whole network; Hard hides the street map's names
{
  const p = await openPage({ phone: true });
  await p.go(); await clearSite(p); await p.reload(); await sleep(1500);
  for (const n of pick(() => true, [target.name]) ? [pick(() => true, [target.name]).name, pick((r) => r.stops > 20, [target.name]).name] : [])
    await p.guessByTyping(n); // the history grows and the map gets shorter
  await p.ev(`document.querySelector('button[aria-label="Show whole map"]').click()`); await sleep(400);
  // visible map = the map's box above the guess panel (the panel is what a player sees below it)
  const off = await p.ev(`(() => { const r = document.querySelector('svg.map').getBoundingClientRect();
    const bottom = Math.min(r.bottom, document.querySelector('.panel').getBoundingClientRect().top);
    return [...document.querySelectorAll('g.stop circle.dot')].filter(c => { const b = c.getBoundingClientRect();
      const x = b.x + b.width / 2, y = b.y + b.height / 2; return x < r.left || x > r.right || y < r.top || y > bottom; }).length; })()`);
  check('MAP5', off === 0, `phone 390×844 after two guesses and "show whole map": ${off} stations outside the map view`);
  await p.close();
}
{
  const p = await openPage({ webgl: true });
  await p.go(); await clearSite(p); await p.reload();
  const hardBox = `[...document.querySelectorAll('nav label')].find(l => l.textContent.includes('Hard')).querySelector('input')`;
  await p.ev(`${hardBox}.click()`);
  await sleep(6000);
  const shown = await p.ev(`(() => { const v = document.querySelector('.basemap')?.dataset.textLayers; return v === undefined ? null : Number(v); })()`);
  check('MAP6', shown === 0, `Hard mode: street-map text layers visible = ${shown}`);
  await p.close();
}

// ================= DIAG: diagram mode draws every line as valid rounded ribbons
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.ev(`[...document.querySelectorAll('.mapmode button')].find(b => b.textContent === 'Diagram').click()`); await sleep(500);
  const r = await p.ev(`(() => { const ps = [...document.querySelectorAll('.tracks path.ribbon')];
    return [ps.length, ps.filter(x => /NaN|Infinity/.test(x.getAttribute('d'))).length, new Set(ps.map(x => x.dataset.line)).size,
            document.querySelectorAll('.capsule').length, !!document.querySelector('path.water'),
            document.querySelectorAll('.legend li').length]; })()`);
  check('DIAG', r[0] > 0 && r[1] === 0 && r[2] === 17 && r[3] > 0 && r[4] && r[5] >= 6,
    `diagram: ${r[0]} ribbons, ${r[1]} broken, ${r[2]} of 17 lines, ${r[3]} capsules, bay ${r[4]}, legend rows ${r[5]}`);
  await p.close();
}

// ================= CTX, REG: V/Line as context, and the Regional practice mode
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  const ctxMap = await p.ev(`document.querySelectorAll('.context polyline').length`);
  await p.ev(`[...document.querySelectorAll('.mapmode button')].find(b => b.textContent === 'Diagram').click()`); await sleep(400);
  const ctxDia = await p.ev(`document.querySelectorAll('.context polyline').length`);
  check('CTX', ctxMap > 50 && ctxDia > 50, `V/Line context in the metro game: ${ctxMap} tracks on the map, ${ctxDia} on the diagram`);
  await p.mode('Regional'); await sleep(500);
  const regInfo = await p.ev(`[document.querySelector('.top .meta').textContent, document.querySelectorAll('g.stop').length]`);
  await p.clickButton('Hints'); await sleep(150);
  const regHints = (await p.ev(`[...document.querySelectorAll('.shop .grid button')].map(b => b.innerText.split('\\n')[0])`)) as string[];
  check('REGH', JSON.stringify(regHints) === JSON.stringify(['A line', 'First letter', 'Area']), `Regional hints offered: ${JSON.stringify(regHints)}`);
  await p.guessByTyping('Bendigo');
  const row = await p.text('.history ol li');
  const target = await p.ev(`(() => { try { return null; } catch { return null; } })()`); void target;
  check('REG', regInfo[0].includes('Regional') && regInfo[1] === 111 && /Bendigo/.test(row ?? '') && (/stops/.test(row ?? '') || /Got it/.test(row ?? '')),
    `Regional mode: "${regInfo[0]}", ${regInfo[1]} V/Line stations; guess row "${(row ?? '').replace(/\n/g, ' ')}"`);
  await p.close();
}

// ================= CONN: Connect mode, played along the shortest path
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.mode('Connect'); await sleep(500);
  const [fromName, toName] = (await p.ev(`[...document.querySelectorAll('.connect .route b')].map(b => b.textContent)`)) as string[];
  const from = byName(fromName).id, to = byName(toName).id;
  // shortest path by stops (breadth-first), from the engine's own neighbours
  const prev = new Map<string, string>([[from, '']]); const q = [from];
  while (q.length) { const s0 = q.shift()!; for (const n of neighbours(net, s0)) if (!prev.has(n)) { prev.set(n, s0); q.push(n); } }
  const path: string[] = []; for (let x = to; x; x = prev.get(x)!) path.unshift(x);
  const head = await p.text('.top .meta');
  await p.guessByTyping(nameOf(path[1]));
  const trend = await p.text('.trend');
  for (const id of path.slice(2)) await p.guessByTyping(nameOf(id));
  const res = await p.text('.result');
  check('CONN', /^Connect #\d+$/.test(head ?? '') && trend === 'Closer'
    && !!res?.includes(`in ${path.length - 1} (par ${path.length - 1})`) && !!res?.includes('★★★'),
    `${head}: ${fromName} → ${toName}; first move "${trend}"; result "${res?.split('\n').slice(0, 2).join(' / ')}"`);
  await p.close();
}

// CONN3: Connect is played by NAME: nothing on screen names a stop you haven't reached (user, 2026-11-19)
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.mode('Connect'); await sleep(1500);
  const [fromName, toName] = (await p.ev(`[...document.querySelectorAll('.connect .route b')].map(b => b.textContent)`)) as string[];
  const from = byName(fromName).id;
  const nbs = neighbours(net, from);
  const buttons = await p.ev(`document.querySelectorAll('.nextstops button').length`);
  const labelText = async () => (await p.ev(`[...document.querySelectorAll('svg.map .labels text')].map(t => t.textContent).join('|')`)) as string;
  const named0 = await labelText();
  const leakedLabel = nbs.filter((n) => named0.split('|').includes(nameOf(n))).map(nameOf);
  const leakedAria = (await p.ev(`${JSON.stringify(nbs)}.map(id => document.getElementById('stop-' + id)?.getAttribute('aria-label'))`)) as string[];
  const streetText = await p.ev(`document.querySelector('.basemap')?.dataset.textLayers ?? null`);
  // a real tap on a neighbour does not move you, and its card does not name it
  const c = await p.ev(`(() => { const b = document.getElementById('stop-${nbs[0]}').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: c[0], y: c[1], button: 'left', clickCount: 1 });
  await sleep(400);
  const stillAt = await p.ev(`document.querySelector('.connect .sub b')?.textContent`);
  const card = await p.ev(`(() => { const d = document.querySelector('[role=dialog].card'); return d ? [d.querySelector('strong').textContent, !!d.querySelector('.primary')] : null; })()`);
  await p.key('Escape', 'Escape', 27);
  // typing: a far stop is explained; the right name moves you and that stop is now named
  const far = net.stations.find((x) => x.id !== from && !nbs.includes(x.id) && x.name !== toName)!;
  await p.guessByTyping(far.name);
  const warn = await p.text('.connect .warn');
  await p.guessByTyping(nameOf(nbs[0]));
  await sleep(900);
  const here = await p.ev(`document.querySelector('.connect .sub b')?.textContent`);
  const named1 = (await labelText()).split('|');
  const you = await p.ev(`document.querySelector('.you')?.closest('g[data-at]')?.dataset.at ?? null`);
  const onScreen = await p.ev(`(() => { const r = document.querySelector('svg.map').getBoundingClientRect();
    const inside = (id) => { const b = document.getElementById('stop-' + id).getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
      return x > r.left && x < r.right && y > r.top && y < r.bottom; }; return [inside(${JSON.stringify(nbs[0])}), inside(${JSON.stringify(byName(toName).id)})]; })()`);
  check('CONN3', buttons === 0 && leakedLabel.length === 0 && leakedAria.every((a) => a === 'Stop') && streetText === '0'
    && named0.split('|').includes(fromName) && named0.split('|').includes(toName)
    && stillAt === fromName && !!card && card[0] === 'This stop' && card[1] === false
    && /isn't next to/.test(warn ?? '') && here === nameOf(nbs[0]) && named1.includes(nameOf(nbs[0])) && you === nbs[0] && onScreen[0] && onScreen[1],
    `buttons ${buttons}; neighbour names in labels ${JSON.stringify(leakedLabel)}, aria ${JSON.stringify(leakedAria)}; street text layers ${streetText}; `
    + `tap kept you at ${stillAt}, card ${JSON.stringify(card)}; far: "${warn}"; typed → at ${here}, now named ${named1.includes(nameOf(nbs[0]))}; you ${you}; on screen ${JSON.stringify(onScreen)}`);
  await p.close();
}

// CONN2: follow "Which way?" all the way (one star), and today's game survives a reload
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.mode('Connect');
  await p.clickButton('Which way?'); await sleep(150);
  const first = ((await p.text('.connect .warn')) ?? '').replace(/^Try |\.$/g, '');
  await p.guessByTyping(first);
  await p.reload(); await p.mode('Connect');
  const resumed = await p.ev(`document.querySelector('.connect .sub')?.textContent ?? ''`);
  for (let i = 0; i < 20 && !(await p.ev(`!!document.querySelector('.result')`)); i++) {
    await p.clickButton('Which way?'); await sleep(150);
    const next = ((await p.text('.connect .warn')) ?? '').replace(/^Try |\.$/g, '');
    await p.guessByTyping(next);
  }
  const res = await p.text('.result');
  check('CONN2', /moves 1 /.test(resumed) && !!res?.startsWith('Reached') && (await p.ev(`document.querySelector('.stars').textContent`)) === '★★★' && (await p.ev(`document.querySelector('.stars').getAttribute('aria-label')`)) === '1 of 3 stars',
    `resumed after reload: "${resumed.trim()}"; result "${res?.split('\n')[0]}"; stars ${await p.ev(`document.querySelector('.stars').getAttribute('aria-label')`)}`);
  await p.close();
}

// ================= LABH: Labels and Hard: shown only where they apply, remembered, and Hard is played by name
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  const toggles = async () => (await p.ev(`[...document.querySelectorAll('nav label')].map(l => l.textContent.trim()).filter(t => t === 'Labels' || t === 'Hard').join(',')`)) as string;
  const soundDefault = await p.ev(`document.querySelector('label.sound input').checked`); // on for everyone by default (user, 2026-11-19)
  const perMode: Record<string, string> = {};
  for (const m of ['Daily', 'Practice', 'Regional (V/Line)', 'Connect', 'Line Run', 'My map']) { await p.mode(m); await sleep(200); perMode[m] = await toggles(); }
  await p.mode('Daily'); await sleep(200);
  // labels off is remembered across a reload
  await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Labels').querySelector('input').click()`); await sleep(100);
  await p.reload(); await sleep(300);
  const labelsAfter = await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Labels').querySelector('input').checked`);
  await p.ev(`(() => { const i = [...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Labels').querySelector('input'); if (!i.checked) i.click(); })()`); await sleep(100);
  // Hard: labels box shows unticked, and a new Practice game starts in Hard
  await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard').querySelector('input').click()`); await sleep(200);
  const labelsInHard = await p.ev(`(() => { const i = [...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Labels').querySelector('input'); return [i.checked, i.disabled]; })()`);
  await p.mode('Practice'); await sleep(300);
  // Practice keeps its own Hard setting: Daily's doesn't carry over; switch it on here
  const practiceHard = (await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard').querySelector('input').checked`)) === false;
  await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard').querySelector('input').click()`); await sleep(200);
  // Hard is played by name: a tapped stop has no guess button
  const anyStop = net.stations[0].id;
  await p.ev(`document.getElementById('stop-${anyStop}').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(200);
  const card = await p.ev(`(() => { const d = document.querySelector('[role=dialog].card'); return d ? [d.querySelector('strong').textContent, !!d.querySelector('.primary')] : null; })()`);
  await p.key('Escape', 'Escape', 27);
  // the Hard choice survives a reload too (new daily game in a fresh day picks it up)
  await p.reload(); await sleep(300);
  const hardAfter = await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard').querySelector('input').checked`);
  const want = { 'Daily': 'Labels,Hard', 'Practice': 'Labels,Hard', 'Regional (V/Line)': 'Labels,Hard', 'Connect': '', 'Line Run': '', 'My map': 'Labels' };
  check('SOUND', soundDefault === true, `sound on by default: ${soundDefault}`);
  check('LABH', JSON.stringify(perMode) === JSON.stringify(want) && labelsAfter === false && labelsInHard[0] === false && labelsInHard[1] === true
    && practiceHard === true && !!card && card[0] === 'This stop' && card[1] === false && hardAfter === true,
    `toggles per mode ${JSON.stringify(perMode)}; labels off kept ${labelsAfter === false}; labels in Hard ${JSON.stringify(labelsInHard)}; Practice kept its own Easy ${practiceHard}; Hard card ${JSON.stringify(card)}; Hard kept after reload ${hardAfter}`);
  await p.close();
}

// ================= HARD2: the Hard toggle is never a dead grey box (user, 2026-11-19)
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  const hardBox = `[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard').querySelector('input')`;
  const boxState = async () => (await p.ev(`(() => { const b = ${hardBox}; return [b.checked, b.disabled]; })()`)) as boolean[];
  await p.guessByTyping('Richmond');
  await p.ev(`${hardBox}.click()`); await sleep(200);
  const easyStarted = await boxState();
  const note = await p.text('.hardnote');
  await p.mode('Practice'); await sleep(300);
  await p.ev(`${hardBox}.click()`); await sleep(200); // before a guess, Hard switches this game
  const practiceHard = (await boxState())[0];
  await p.guessByTyping('Richmond');
  await p.ev(`${hardBox}.click()`); await sleep(200);
  const dropped = await boxState();
  const counter = await p.ev(`document.querySelector('.panel')?.textContent.match(/Guesses \\d+\\/\\d+/)?.[0] ?? null`);
  const labelsOn = await p.ev(`!([...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Labels').querySelector('input').disabled)`);
  check('HARD2', easyStarted[0] === false && easyStarted[1] === false && /tomorrow's Daily/.test(note ?? '') && practiceHard === true
    && dropped[0] === false && dropped[1] === false && counter === 'Guesses 1/8' && labelsOn,
    `daily started in Easy, click Hard → box ${JSON.stringify(easyStarted)}, note "${note}"; next Practice in Hard ${practiceHard}; Hard dropped mid-game → box ${JSON.stringify(dropped)}, ${counter}, labels usable ${labelsOn}`);
  await p.close();
}

// ================= DAILYHARD: a new player's Daily starts in Hard; Practice in Easy; turning Daily's off is remembered (user, 2026-11-21)
{
  const p = await openPage();
  await p.go(); await clearSite(p, { dailyEasy: false }); await p.reload(); await sleep(300);
  const hardBox = `[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard').querySelector('input')`;
  const dailyOn = await p.ev(`${hardBox}.checked`);
  const counter = await p.ev(`document.querySelector('.panel')?.textContent.match(/Guesses \\d+\\/\\d+/)?.[0] ?? null`);
  await p.mode('Practice'); await sleep(300);
  const practiceOn = await p.ev(`${hardBox}.checked`);
  await p.mode('Daily'); await sleep(300);
  await p.ev(`${hardBox}.click()`); await sleep(200);
  await p.reload(); await sleep(300);
  const offKept = await p.ev(`${hardBox}.checked`);
  check('DAILYHARD', dailyOn === true && counter === 'Guesses 0/12' && practiceOn === false && offKept === false,
    `fresh Daily in Hard ${dailyOn} (${counter}); Practice in Hard ${practiceOn}; Daily switched to Easy and reloaded → Hard ${offKept}`);
  await p.close();
}

// ================= MODESW: switching between any two modes, mid-game, never breaks the page
{
  const p = await openPage();
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; addEventListener('error', (e) => __errs.push(String(e.message))); addEventListener('unhandledrejection', (e) => __errs.push(String(e.reason)));` });
  await p.go(); await clearSite(p); await p.reload();
  const modes: [string, string][] = [['Daily', 'daily'], ['Practice', 'practice'], ['Regional (V/Line)', 'regional'], ['Connect', 'connect'], ['Line Run', 'linerun'], ['My map', 'collection']];
  const panelFor: Record<string, string> = { daily: 'Hints', practice: 'Hints', regional: 'Hints', connect: '→', linerun: 'Name every station', collection: 'stations met' };
  const bad: string[] = [];
  const doSomething = async (m: string) => {
    if (m === 'daily' || m === 'practice') await p.guessByTyping('Richmond');
    else if (m === 'regional') await p.guessByTyping('Geelong');
    else if (m === 'connect') await p.guessByTyping('Flinders Street');
    else if (m === 'linerun') { await p.clickButton('Start'); await sleep(100); await p.guessByTyping('Richmond'); }
  };
  for (const [fromLabel, from] of modes) for (const [toLabel, to] of modes) {
    if (from === to) continue;
    await p.mode(fromLabel); await sleep(150);
    await doSomething(from);
    await p.mode(toLabel); await sleep(250);
    const panel = (await p.ev(`document.querySelector('.panel')?.innerText ?? ''`)) as string;
    const errs = (await p.ev(`window.__errs.splice(0)`)) as string[];
    if (errs.length || !panel.includes(panelFor[to])) bad.push(`${from}→${to}: ${errs[0] ?? 'panel "' + panel.slice(0, 40).replace(/\s+/g, ' ') + '"'}`);
  }
  check('MODESW', bad.length === 0, bad.length ? bad.slice(0, 4).join(' | ') : `all ${modes.length * (modes.length - 1)} switches clean`);
  await p.close();
}

// ================= SOUND3: sound reaches real browsers (user, 2026-11-19: "no sound in my browser")
{
  const p = await openPage();
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.__tones = 0; window.__ctx = []; const A = window.AudioContext;
    window.AudioContext = class extends A { constructor(...a) { super(...a); window.__ctx.push(this); } createOscillator() { window.__tones++; return super.createOscillator(); } }; })();` });
  await p.go(); await clearSite(p);
  await p.ev(`localStorage.setItem('chug:sound', 'false')`); // left over from when sound started off
  await p.reload(); await sleep(300);
  const onDespiteOld = await p.ev(`document.querySelector('label.sound input').checked`);
  // the first tap anywhere unlocks audio, before any cue is needed
  const c = await p.ev(`(() => { const b = document.querySelector('.panel').getBoundingClientRect(); return [b.x + 10, b.y + b.height - 10]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: c[0], y: c[1], button: 'left', clickCount: 1 });
  await sleep(300);
  const unlocked = await p.ev(`window.__ctx.map(x => x.state)`);
  // switching sound off then on plays a test cue
  await p.ev(`document.querySelector('label.sound input').click()`); await sleep(100);
  const before = await p.ev(`window.__tones`);
  await p.ev(`document.querySelector('label.sound input').click()`); await sleep(300);
  const after = await p.ev(`window.__tones`);
  check('SOUND3', onDespiteOld === true && JSON.stringify(unlocked) === '["running"]' && after > before,
    `on despite an old saved "off": ${onDespiteOld}; audio after first tap: ${JSON.stringify(unlocked)}; test cue on switching on: ${after > before}`);
  await p.close();
}

// ================= SOUND4: a test button that reports what the browser's audio is doing; dev never keeps an offline worker
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.ev(`document.querySelector('button[aria-label="How to play"]').click()`); await sleep(200);
  const stateBefore = await p.text('.audiostate');
  const tb = await p.ev(`(() => { const b = [...document.querySelectorAll('dialog button')].find(x => x.textContent.includes('Test sound')).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: tb[0], y: tb[1], button: 'left', clickCount: 1 }); // a real tap, as a person gives
  await sleep(500);
  const stateAfter = await p.text('.audiostate');
  const devCleanup = await p.ev(`fetch('./').then(r => r.text()).then(t => t.includes('data-dev-sw-cleanup'))`);
  check('SOUND4', !!stateBefore && /running/i.test(stateAfter ?? '') && devCleanup === true,
    `audio state before "${stateBefore}", after Test sound "${stateAfter}"; dev page clears stale offline workers ${devCleanup}`);
  await p.close();
}

// ================= NOLAB: with labels off, tapping a stop does not tell you its name (user, 2026-11-19)
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.mode('Practice'); await sleep(300); // the card's guess button lives in Practice only
  await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Labels').querySelector('input').click()`); await sleep(200);
  const st = net.stations.find((x) => x.name === 'Box Hill')!;
  await p.ev(`document.getElementById('stop-${st.id}').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(300);
  const card = await p.ev(`(() => { const d = document.querySelector('[role=dialog].card'); return d ? [d.querySelector('strong').textContent, d.getAttribute('aria-label'), d.querySelector('.primary')?.textContent.trim() ?? null] : null; })()`);
  const onMap = await p.ev(`[...document.querySelectorAll('svg.map .labels text')].some(t => t.textContent === ${JSON.stringify(st.name)})`);
  const aria = await p.ev(`document.getElementById('stop-${st.id}').getAttribute('aria-label')`);
  await p.clickButton('Guess this', `document.querySelector('.card')`); await sleep(500);
  const namedAfter = await p.ev(`[...document.querySelectorAll('svg.map .labels text')].some(t => t.textContent === ${JSON.stringify(st.name)})`);
  // HARDTAP: Practice in Hard (with labels off too) offers no guess button on the card
  await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard').querySelector('input').click()`); await sleep(200);
  await p.mode('Daily'); await sleep(200); await p.mode('Practice'); await sleep(300);
  const other = net.stations.find((x) => x.name === 'Camberwell')!;
  await p.ev(`document.getElementById('stop-${other.id}').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(300);
  const hardCard = await p.ev(`(() => { const d = document.querySelector('[role=dialog].card'); return d ? [d.querySelector('strong').textContent, d.querySelector('.primary')?.textContent.trim() ?? null, d.querySelectorAll('.chip').length] : null; })()`);
  const hardOn = await p.ev(`[...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard').querySelector('input').checked`);
  check('HARDTAP', hardOn === true && !!hardCard && hardCard[0] === 'This stop' && hardCard[1] === null && hardCard[2] === 0,
    `Practice in Hard, labels off, tapped ${other.name}: card ${JSON.stringify(hardCard)}`);
  check('NOLAB', !!card && card[0] === 'This stop' && card[1] === 'This stop' && card[2] === 'Guess this' && onMap === false && aria === 'Stop' && namedAfter === true,
    `labels off, tapped ${st.name}: card ${JSON.stringify(card)}, named on map ${onMap}, aria "${aria}"; after guessing it, named ${namedAfter}`);
  await p.close();
}

// ================= SOUND2: every action that answers you makes a sound, in every mode (user, 2026-11-19)
{
  const p = await openPage();
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.__tones = 0; const A = window.AudioContext;
    window.AudioContext = class extends A { createOscillator() { window.__tones++; return super.createOscillator(); } }; })();` });
  await p.go(); await clearSite(p); await p.reload();
  const tones = async () => (await p.ev(`window.__tones`)) as number;
  const heard: Record<string, boolean> = {};
  const act = async (name: string, f: () => Promise<unknown>) => { const b = await tones(); await f(); await sleep(250); heard[name] = (await tones()) > b; };
  await act('daily guess', () => p.guessByTyping('Richmond'));
  await act('daily hint', async () => { await p.clickButton('Hints'); await sleep(150); await p.ev(`[...document.querySelectorAll('.shop .grid button')].find(b => !b.disabled)?.click()`); });
  await p.mode('Practice'); await sleep(200);
  await act('practice guess', () => p.guessByTyping('Richmond'));
  await p.mode('Regional (V/Line)'); await sleep(200);
  await act('regional guess', () => p.guessByTyping('Geelong'));
  await p.mode('Connect'); await sleep(400);
  const [fromName] = (await p.ev(`[...document.querySelectorAll('.connect .route b')].map(b => b.textContent)`)) as string[];
  if (!byName(fromName)) heard['connect panel shown'] = false; // a broken mode switch fails here instead of crashing the run
  else {
    const nb = neighbours(net, byName(fromName).id);
    const far = net.stations.find((x) => x.name !== fromName && !nb.includes(x.id))!;
    await act('connect refused', () => p.guessByTyping(far.name));
    await act('connect which way', () => p.clickButton('Which way?'));
    await act('connect move', () => p.guessByTyping(nameOf(nb[0])));
  }
  await p.mode('Line Run'); await sleep(200);
  await p.ev(`(() => { const sel = document.querySelector('.runready select'); sel.value = 'SHM'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await act('run start', () => p.clickButton('Start'));
  await act('run found', () => p.guessByTyping(nameOf(lineStations(net, 'SHM')[0])));
  await act('run miss', () => p.guessByTyping('Frankston'));
  await act('run give up', () => p.clickButton('Give up'));
  const silent = Object.entries(heard).filter(([, v]) => !v).map(([k]) => k);
  check('SOUND2', silent.length === 0, `silent actions: ${JSON.stringify(silent)} (of ${Object.keys(heard).length})`);
  await p.close();
}

// ================= RUN: Line Run on the Sandringham line (ready screen, clock fits the line, names hidden, give up)
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.mode('Line Run'); await sleep(400);
  await p.ev(`(() => { const sel = document.querySelector('.runready select'); sel.value = 'SHM'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(300);
  const shm = lineStations(net, 'SHM');
  const ready = await p.text('.runready');
  await sleep(1500);
  const notTicking = await p.ev(`!document.querySelector('.clock')`);
  await p.clickButton('Start'); await sleep(1200);
  const labelText = async () => ((await p.ev(`[...document.querySelectorAll('svg.map .labels text')].map(t => t.textContent).join('|')`)) as string).split('|');
  const leaked = (await labelText()).filter((n) => shm.map(nameOf).includes(n));
  const street = await p.ev(`document.querySelector('.basemap')?.dataset.textLayers ?? null`);
  const inView = await p.ev(`(() => { const r = document.querySelector('svg.map').getBoundingClientRect();
    return ${JSON.stringify(shm)}.every(id => { const b = document.getElementById('stop-' + id).getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }); })()`);
  const selDuring = await p.ev(`!!document.querySelector('.connect select, .runready')`);
  // a tap does not name or answer
  await p.ev(`document.getElementById('stop-${shm[0]}').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(200);
  const card = await p.ev(`(() => { const d = document.querySelector('[role=dialog].card'); return d ? [d.querySelector('strong').textContent, !!d.querySelector('.primary')] : null; })()`);
  await p.key('Escape', 'Escape', 27);
  await p.guessByTyping('Frankston');
  const miss = await p.text('.runmsg.bad');
  await p.guessByTyping(nameOf(shm[0]));
  const hit = await p.text('.runmsg.ok');
  const namedAfter = (await labelText()).includes(nameOf(shm[0]));
  await p.clickButton('Give up'); await sleep(300);
  const res = await p.text('.result');
  check('RUN', /14 stations/.test(ready ?? '') && /2:10/.test(ready ?? '') && notTicking && leaked.length === 0 && street === '0' && inView && !selDuring
    && !!card && card[0] === 'This stop' && card[1] === false
    && /isn't on the Sandringham line/.test(miss ?? '') && hit === `✓ ${nameOf(shm[0])}` && namedAfter
    && !!res?.includes('1 of 14') && !!res?.includes('Missed') && !!res?.includes(nameOf(shm[1])),
    `ready "${ready?.replace(/\s+/g, ' ')}"; clock waits ${notTicking}; names leaked ${JSON.stringify(leaked)}; street text ${street}; whole line in view ${inView}; picker during play ${selDuring}; `
    + `card ${JSON.stringify(card)}; miss "${miss}"; hit "${hit}" named ${namedAfter}; result "${res?.replace(/\s+/g, ' ').slice(0, 140)}"`);
  // a second run on the same line, finished
  await p.clickButton('New Line Run'); await sleep(300);
  await p.ev(`(() => { const sel = document.querySelector('.runready select'); sel.value = 'SHM'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await p.clickButton('Start'); await sleep(300);
  for (const id of shm) await p.guessByTyping(nameOf(id));
  const res2 = await p.text('.result');
  check('RUN2', !!res2?.startsWith(`All ${shm.length} found!`), `result "${res2?.split('\n')[0]}"`);
  await p.close();
}

// ================= DUEL: a friend's link to Burnley; they solved it in 4 with no hints (140 pts)
{
  const p = await openPage();
  await p.go(); await clearSite(p);
  const code = duelEncode(net, byName('Burnley').id, { guesses: 4, spent: 0, hard: false });
  await p.goTo(URL + '#duel=' + code); await sleep(300);
  const head = await p.text('.top .meta');
  await p.guessByTyping('Richmond'); await p.guessByTyping('Burnley');
  const verdict = await p.text('.verdict');
  await p.ev(`navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }`);
  await p.clickButton('Send your result'); await sleep(200);
  const copied = (await p.ev(`window.__copied ?? ''`)) as string;
  const back = duelDecode(net, copied.split('#duel=')[1] ?? '');
  check('DUEL', head === 'Duel · beat 140 pts' && /^You win! 160 vs their 140 pts/.test(verdict ?? '') && back?.targetId === byName('Burnley').id
    && back?.result.guesses === 2 && back?.result.spent === 0 && back?.result.hard === false,
    `link ${code} → header "${head}", verdict "${verdict}", reply link carries ${back ? nameOf(back.targetId) + ' / ' + JSON.stringify(back.result) : 'nothing'}`);

  // DUEL5: their reply for the same station shows the finished duel against it, no replay (user, 2026-11-21)
  await p.ev(`location.hash = '#duel=${duelEncode(net, byName('Burnley').id, { guesses: 3, spent: 20, hard: false })}'`); await sleep(400);
  const replyGuesses = await p.guesses();
  const replyVerdict = await p.text('.verdict');
  check('DUEL5', replyGuesses === 2 && /^You win! 160 vs their 130 pts/.test(replyVerdict ?? ''), `reply link: kept my ${replyGuesses} guesses; verdict "${replyVerdict}"`);

  // DUEL6: leaving a duel clears the link from the address bar; the menu still offers the way back
  await p.mode('Daily'); await sleep(300);
  const hashAfter = await p.ev(`location.hash`);
  const offered = await p.ev(`!![...document.querySelectorAll('.modesel option')].find(o => o.value === 'duel' && !o.disabled)`);
  await p.mode('Duel'); await sleep(300);
  check('DUEL6', hashAfter === '' && offered === true && (await p.guesses()) === 2 && /^You win!/.test((await p.text('.verdict')) ?? ''),
    `after leaving, hash "${hashAfter}", Duel in menu ${offered}; back in the duel with ${await p.guesses()} guesses`);
  await p.close();
}

// ================= DUELNEW: start a duel from the menu, play it, send it; the friend is told what to beat (user, 2026-11-21)
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.mode('Duel'); await sleep(300);
  const head = await p.text('.top .meta');
  const intro = await p.text('.duelintro');
  const hardShown = await p.ev(`!![...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard')`);
  const tid = (await p.ev(`JSON.parse(localStorage.getItem('chug:duel:last')).targetId`)) as string;
  await p.guessByTyping(nameOf(tid)); await sleep(300);
  await p.ev(`navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }`);
  await p.clickButton('Challenge a friend'); await sleep(200);
  const msg = (await p.ev(`window.__copied ?? ''`)) as string;
  const sent = duelDecode(net, msg.split('#duel=')[1] ?? '');
  await p.reload(); await sleep(300);
  const afterReload = await p.text('.top .meta');
  await p.mode('Duel'); await sleep(300);
  const backGuesses = await p.guesses();
  await p.close();
  const f = await openPage();
  await f.go(); await clearSite(f);
  await f.goTo(msg.slice(msg.indexOf('http'))); await sleep(400);
  const friendIntro = await f.text('.duelintro');
  check('DUELNEW', head === 'Duel · new challenge' && /^Find this station/.test(intro ?? '') && hardShown === true
    && /^I found this Stops Away station in 1 guess: 170 pts \(Easy\)\. Can you beat it\? http/.test(msg) && sent?.targetId === tid && sent?.result.guesses === 1
    && afterReload !== head && backGuesses === 1
    && friendIntro === 'A friend found this station in 1 guess, no hints: 170 pts. Beat it in Easy (8 guesses).',
    `menu → "${head}" / "${intro}", Hard switch ${hardShown}; sent "${msg.slice(0, 80)}…"; reload → "${afterReload}", Duel again → ${backGuesses} guess; friend sees "${friendIntro}"`);
  await f.close();
}

// DUELPHONE: the friend's first screen fits a phone, with no sideways scroll
{
  const p = await openPage({ phone: true });
  await p.go(); await clearSite(p);
  await p.goTo(URL + '#duel=' + duelEncode(net, byName('Burnley').id, { guesses: 4, spent: 20, hard: false })); await sleep(500);
  const fit = (await p.ev(`[document.documentElement.scrollWidth, innerWidth, (() => { const r = document.querySelector('.duelintro')?.getBoundingClientRect(); return r ? Math.round(r.right) : null; })()]`)) as number[];
  check('DUELPHONE', fit[0] <= fit[1] && fit[2] !== null && fit[2] <= fit[1], `page ${fit[0]}px wide in a ${fit[1]}px screen; intro ends at ${fit[2]}px`);
  await p.close();
}

// ================= PHONE: the phone layout (user's iPhone screenshots, 2026-11-21: congested; badges over the header; credits as an icon)
{
  const p = await openPage({ phone: true, scheme: 'dark' });
  await p.go(); await clearSite(p); await p.reload();
  const lay = async () => (await p.ev(`(() => {
    const vis = (e) => !!e && e.getClientRects().length > 0;
    const mid = (e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2); };
    const items = [document.querySelector('.top strong'), document.querySelector('.helpbtn'), ...document.querySelectorAll('nav > *')].filter(vis);
    return { rows: new Set(items.map(e => Math.round(mid(e) / 12))).size, header: Math.round(document.querySelector('.top').getBoundingClientRect().height),
      strip: [...document.querySelectorAll('.credit')].some(vis), wide: document.documentElement.scrollWidth > innerWidth, input: !!document.querySelector('input[role=combobox]') };
  })()`)) as any;
  const playing = await lay();
  // options: Labels and Hard behind one button; tapping the map closes it
  // the switches' own boxes, not #opts: a display:contents wrapper has none either way
  const switchesShown = () => p.ev(`[...document.querySelectorAll('#opts label')].some(l => l.getClientRects().length > 0)`);
  const optsBefore = await switchesShown();
  const btnShown = await p.ev(`document.querySelector('.optsbtn').getClientRects().length > 0`);
  await p.ev(`document.querySelector('.optsbtn').click()`); await sleep(150);
  const optsOpen = await p.ev(`[...document.querySelectorAll('#opts label')].filter(l => l.getClientRects().length).map(l => l.textContent.trim()).join(',')`);
  await p.ev(`document.querySelector('svg.map').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`); await sleep(150);
  const optsAfter = await switchesShown();
  // credits: one small button opens them all
  await p.ev(`document.querySelector('.infobtn').click()`); await sleep(150);
  const credits = (await p.text('#credits')) ?? '';
  await p.ev(`document.querySelector('.infobtn').click()`); await sleep(150);
  await p.guessByTyping(byName('Richmond').id === target.id ? 'Flinders Street' : 'Richmond');
  await p.guessByTyping(target.name); await sleep(300);
  const toastBox = (await p.ev(`(() => { const t = document.querySelector('.toast')?.getBoundingClientRect(), m = document.querySelector('.map-wrap').getBoundingClientRect();
    return t ? t.top >= m.top && t.bottom <= m.bottom && t.left >= m.left && t.right <= m.right : null; })()`)) as boolean | null;
  const done = await lay();
  const okPlay = playing.rows === 1 && playing.header <= 56 && !playing.strip && !playing.wide && playing.input;
  const okOpts = btnShown === true && optsBefore === false && optsOpen === 'Labels,Hard' && optsAfter === false;
  const okCredits = /OpenStreetMap/.test(credits) && /GTFS/.test(credits);
  const okDone = toastBox === true && !done.strip && !done.input && !done.wide;
  check('PHONE', okPlay && okOpts && okCredits && okDone,
    `playing ${JSON.stringify(playing)}; options button shown ${btnShown}, switches ${optsBefore}→"${optsOpen}"→${optsAfter}; credits ${okCredits}; solved ${JSON.stringify(done)}, badge card inside the map ${toastBox}`);
  await p.close();
}

// DUEL2: a link where they missed, opened fresh in a new tab
{
  const p = await openPage();
  await p.goTo(URL + '#duel=' + duelEncode(net, byName('Sunbury').id, { guesses: null, spent: 0, hard: false }));
  check('DUEL2', (await p.text('.top .meta')) === 'Duel · they missed it', `fresh tab header: "${await p.text('.top .meta')}"`);
  await p.close();
}

// DUEL3, DUEL4: a Hard challenge is played in Hard, with no switch to change it; a reload keeps the duel
{
  const p = await openPage();
  await p.go(); await clearSite(p);
  await p.goTo(URL + '#duel=' + duelEncode(net, byName('Sunbury').id, { guesses: 6, spent: 40, hard: true })); await sleep(300);
  const head = await p.text('.top .meta');
  const hardSwitch = await p.ev(`!![...document.querySelectorAll('nav label')].find(l => l.textContent.trim() === 'Hard')`);
  const counter = await p.text('.history');
  check('DUEL3', head === 'Duel · Hard · beat 120 pts' && hardSwitch === false && /\/\s*12|of 12|12 guesses/.test(counter ?? ''),
    `Hard link → header "${head}", Hard switch shown ${hardSwitch}, history "${counter?.replace(/\s+/g, ' ').slice(0, 60)}"`);
  await p.guessByTyping('Richmond'); await sleep(200);
  await p.reload(); await sleep(500);
  check('DUEL4', (await p.guesses()) === 1 && (await p.text('.top .meta')) === head, `after a reload: ${await p.guesses()} guess, header "${await p.text('.top .meta')}"`);
  await p.close();
}

// ================= COLL: the station collection fills in and survives a reload
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload(); // start from an empty collection
  await p.goTo(URL + '#duel=' + duelEncode(net, byName('Burnley').id, { guesses: 4, spent: 0, hard: false }));
  await p.guessByTyping('Richmond'); await p.guessByTyping('Burnley'); await sleep(300);
  const toast = ((await p.ev(`[...document.querySelectorAll('.toast b')].map(b => b.textContent)`)) as string[]).sort();
  // TOASTGONE: the badge card leaves by itself after 5 s (user's phone, 2026-11-21: it stayed over the map)
  await sleep(5600);
  check('TOASTGONE', toast.length > 0 && (await p.ev(`!document.querySelector('.toast')`)) === true, `badge card shown, then gone after 5.6 s: ${await p.ev(`!document.querySelector('.toast')`)}`);
  await p.mode('My map'); await sleep(400);
  const earnedNow = ((await p.ev(`[...document.querySelectorAll('.badges li.earned b')].map(b => b.textContent)`)) as string[]).sort();
  check('BADGE', JSON.stringify(toast) === JSON.stringify(['Express', 'First stop', 'Platform rival']) && JSON.stringify(earnedNow) === JSON.stringify(toast),
    `duel won in 2: toast ${JSON.stringify(toast)}; My map earned ${JSON.stringify(earnedNow)}`);
  const read = () => p.ev(`[document.querySelector('.collection .route')?.textContent.replace(/\\s+/g, ' ').trim(),
    document.getElementById('stop-${byName('Burnley').id}').classList.contains('got'),
    document.getElementById('stop-${byName('Richmond').id}').classList.contains('met')]`);
  const before = await read();
  await p.reload(); await p.mode('My map'); await sleep(400);
  const after = await read();
  check('COLL', /^2 of 226 stations met · 1 found$/.test(before[0]) && before[1] && before[2] && JSON.stringify(after) === JSON.stringify(before),
    `My map: "${before[0]}", Burnley gold ${before[1]}, Richmond ringed ${before[2]}; after reload ${JSON.stringify(after) === JSON.stringify(before) ? 'the same' : JSON.stringify(after)}`);
  await p.close();
}

// THEME: practice on one line
{
  const p = await openPage();
  await p.go(); await clearSite(p); await p.reload();
  await p.mode('Practice');
  await p.ev(`(() => { const sel = document.querySelector('.theme select'); sel.value = 'SHM'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(300);
  check('THEME', (await p.text('.top .meta')) === 'Practice · Sandringham line', `header "${await p.text('.top .meta')}"`);
  await p.close();
}

// ================= L3: reduced motion
{
  const p = await openPage({ reduceMotion: true });
  await p.go(); await clearSite(p); await p.reload();
  await p.guessByTyping(pick((r) => r.stops > 3, [target.name]).name);
  const anim = await p.ev(`[getComputedStyle(document.querySelector('.dot.pop')).animationName, getComputedStyle(document.querySelector('.callout') ?? document.body).animationName]`);
  const target3 = pickTarget(dayNumber(new Date()), SEED, net.stations);
  await p.guessByTyping(target3.name); await sleep(400);
  const winAnim = await p.ev(`document.querySelector('.win .ripple') ? getComputedStyle(document.querySelector('.win .ripple')).animationName : 'absent'`);
  check('L3', anim[0] === 'none' && anim[1] === 'none' && winAnim === 'none', `pop, callout and win animations with reduced motion: ${anim.join(', ')}, ${winAnim}`);
  await p.close();
}

// Chrome keeps writing its profile for a moment after it is told to stop
await new Promise<void>((r) => { chrome.once('exit', () => r()); chrome.kill(); setTimeout(r, 3000); });
try { rmSync(profile, { recursive: true, force: true }); } catch { /* a temp dir; the OS clears it */ }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} automated checks passed.`);
console.log('Manual only: A1 on a phone; D1-D4 against the PTV journey planner; I1-I2 (run after a production build:');
console.log('  see reports/LOTUS-037); J1 and J4 (focus rings, whole game by keyboard); K1-K3 with real VoiceOver.');
process.exit(failed.length ? 1 : 0);
