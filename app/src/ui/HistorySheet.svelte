<script lang="ts">
  import type { Network } from '../engine/types';
  import type { Feedback } from '../engine/modes/types';
  import { warmth } from '../engine/warmth';

  interface Props { net: Network; guesses: Feedback[]; max: number; focus?: string | null; onfocus?: (id: string) => void; hideLines?: boolean }
  let { net, guesses, max, focus = null, onfocus, hideLines = false }: Props = $props();

  let open = $state(false);
  const name = $derived(Object.fromEntries(net.stations.map((s) => [s.id, s.name])));
  const line = $derived(Object.fromEntries(net.lines.map((l) => [l.id, l])));
  const warm = $derived(warmth(guesses));
  // newest first, with each guess's warmth; collapsed shows the last two
  const shown = $derived(guesses.map((g, i) => ({ g, w: warm[i] })).reverse().slice(0, open ? undefined : 2));
</script>

<section class="history" aria-label="Guesses">
  <header>
    <span>Guesses {guesses.length}/{max}</span>
    {#if guesses.length > 2}
      <button type="button" onclick={() => (open = !open)} aria-expanded={open}>
        {open ? 'Show less' : `Show all ${guesses.length}`}
      </button>
    {/if}
  </header>
  {#if !guesses.length}
    <p class="empty">Type a station's name to guess. Each guess shows how far it is from the hidden station.</p>
  {/if}
  <ol>
    {#each shown as { g, w } (g.stationId)}
      {@const on = (focus ?? guesses.at(-1)?.stationId) === g.stationId}
      <li>
       <!-- a row shows what that guess told you on the map -->
       <button type="button" class="row" class:on aria-pressed={on} onclick={() => onfocus?.(g.stationId)}>
        <span class="sq {w}" aria-hidden="true"></span>
        <span class="name">{name[g.stationId]}</span>
        {#if g.correct}
          <span class="stat">Got it</span>
        {:else if g.route}
          <span class="stat">{g.route.stops} stops · {g.route.changes} {g.route.changes === 1 ? 'change' : 'changes'}</span>
          {#if !hideLines}
          <span class="lines">
            {#each g.route.lines as l, i (i)}
              <span class="chip" data-line={l} style="--c:{line[l].colour}">{line[l].name}</span>
            {/each}
          </span>
          {/if}
        {:else}
          <span class="stat">No route</span>
        {/if}
       </button>
      </li>
    {/each}
  </ol>
</section>

<style>
  .history { font-size: 15px; }
  header { display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 13px; }
  header button { font: inherit; color: var(--accent); background: none; border: 0; padding: 6px 0; cursor: pointer; }
  .empty { color: var(--muted); margin: 6px 0; }
  ol { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 6px; }
  .row { width: 100%; display: grid; grid-template-columns: 14px 1fr auto; gap: 4px 10px; align-items: center; text-align: left;
         padding: 8px 10px; border-radius: 10px; background: var(--surface); border: 1.5px solid transparent; font: inherit; color: inherit; }
  .row:hover { border-color: var(--line); }
  .row.on { border-color: var(--accent); }
  .name { font-weight: 600; }
  .stat { color: var(--muted); font-variant-numeric: tabular-nums; }
  .lines { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { font-size: 12px; padding: 1px 8px 1px 6px; border-radius: 99px; display: inline-flex; align-items: center; gap: 5px;
          background: color-mix(in srgb, var(--c) 14%, transparent); }
  .chip::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .sq { width: 14px; height: 14px; border-radius: 4px; }
  .sq.hit { background: var(--hit); } .sq.warmer { background: var(--warmer); }
  .sq.colder { background: var(--colder); } .sq.first, .sq.same { background: var(--far); }
</style>
