<script lang="ts">
  import type { Station } from '../engine/types';
  import { suggest } from '../engine/match';

  interface Props {
    stations: Station[];
    disabled: boolean;
    used: Set<string>;
    onguess: (id: string) => void;
    onmatches: (ids: Set<string>) => void;
    placeholder?: string;
  }
  let { stations, disabled, used, onguess, onmatches, placeholder = 'Type a station…' }: Props = $props();

  let query = $state('');
  let active = $state(0);
  const matches = $derived(suggest(query, stations).filter((s) => !used.has(s.id)));

  $effect(() => { onmatches(new Set(matches.map((s) => s.id))); });

  function pick(s: Station | undefined) {
    if (!s) return;
    onguess(s.id);
    query = '';
    active = 0;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, matches.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]); }
    else if (e.key === 'Escape') query = '';
  }
</script>

<div class="guess">
  {#if matches.length && query}
    <ul id="suggestions" role="listbox" aria-label="Matching stations">
      {#each matches as s, i (s.id)}
        <!-- options are driven from the input (arrows + Enter), so they take no focus or keys of their own -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li id="opt-{i}" role="option" aria-selected={i === active} class:active={i === active}
          onmousedown={(e) => e.preventDefault()} onclick={() => pick(s)}
          onpointerenter={() => (active = i)}>{s.name}</li>
      {/each}
    </ul>
  {/if}
  <input type="text" placeholder={disabled ? 'Game over' : placeholder} bind:value={query}
    oninput={() => (active = 0)} onkeydown={onKey} {disabled}
    role="combobox" aria-label="Guess a station" aria-expanded={matches.length > 0 && !!query} aria-controls="suggestions"
    aria-activedescendant={matches.length && query ? `opt-${active}` : undefined}
    aria-autocomplete="list" autocomplete="off" autocapitalize="words" spellcheck="false" />
</div>

<style>
  .guess { position: relative; }
  input {
    width: 100%; box-sizing: border-box; font: inherit; font-size: 17px;
    padding: 14px 16px; border-radius: 12px; border: 1.5px solid var(--line);
    background: var(--surface); color: var(--fg);
  }
  input:focus { outline: none; border-color: var(--accent); }
  ul {
    position: absolute; bottom: calc(100% + 6px); left: 0; right: 0; margin: 0; padding: 4px;
    list-style: none; background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
  }
  li { padding: 10px 12px; border-radius: 8px; cursor: pointer; }
  li.active { background: color-mix(in srgb, var(--accent) 16%, transparent); outline: 1.5px solid var(--accent); }
</style>
