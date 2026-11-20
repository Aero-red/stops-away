<script lang="ts">
  import type { HintId, Network } from '../engine/types';
  import { hintText } from '../engine/hints';
  import { HINT_COST, pointsLeft } from '../engine/score';

  interface Props { net: Network; targetId: string; hints: HintId[]; over: boolean; hard?: boolean; onbuy: (h: HintId) => void }
  let { net, targetId, hints, over, hard = false, onbuy }: Props = $props();

  const ORDER: { id: HintId; label: string }[] = [
    { id: 'zone', label: 'Fare zone' }, { id: 'line', label: 'A line' }, { id: 'suburb', label: 'Council' },
    { id: 'letter', label: 'First letter' }, { id: 'region', label: 'Area' },
  ];
  let open = $state(false);
  const left = $derived(pointsLeft(hints, hard));
  const cost = (h: HintId) => HINT_COST[h] * (hard ? 2 : 1);
</script>

<section class="shop" aria-label="Hints">
  <button type="button" class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
    <span>Hints</span> <span class="pts">· {left} pts left</span>
    <svg class="chev" class:open viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
  </button>
  {#if hints.length}
    <ul class="bought">
      {#each hints as h (h)}<li>{hintText(net, targetId, h)}</li>{/each}
    </ul>
  {/if}
  {#if open}
    <div class="grid">
      {#each ORDER.filter((h) => hintText(net, targetId, h.id) !== null) as h (h.id)}
        <!-- a hint the data can't answer here (e.g. fare zones on V/Line) is not offered at all -->
        {@const can = true}
        {@const have = hints.includes(h.id)}
        <button type="button" disabled={over || have || !can || cost(h.id) > left}
          title={can ? '' : 'Not available yet for this map'} onclick={() => onbuy(h.id)}>
          <span>{h.label}</span><span class="cost">{have ? 'bought' : can ? `−${cost(h.id)}` : 'n/a'}</span>
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .shop { display: grid; gap: 6px; }
  .toggle { justify-self: start; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; padding: 7px 12px; }
  .pts { font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; }
  .chev { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; transition: transform 150ms; }
  .chev.open { transform: rotate(180deg); }
  .bought { margin: 0; padding: 0 0 0 18px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; }
  .grid button { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 13px; padding: 8px 10px;
                 min-height: 38px; white-space: nowrap; }
  .cost { color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
