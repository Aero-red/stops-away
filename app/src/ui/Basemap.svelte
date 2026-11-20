<script lang="ts">
  // The real map under the stations: OpenFreeMap vector tiles drawn by MapLibre. MapLibre is
  // loaded only when this component mounts, after the game is on screen, and it never takes
  // input: MapSvg keeps every tap, pan and zoom, and this follows its view.
  import type { View } from './viewport';
  import { cameraFor, type World } from './basemap';

  interface Props { view: View; size: { w: number; h: number }; world: World; plain?: boolean }
  let { view, size, world, plain = false }: Props = $props();

  const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };

  let el: HTMLDivElement;
  let map: import('maplibre-gl').Map | null = null;
  let ready = $state(false);
  let textLayers = $state<number | null>(null); // visible text layers, for tests (data-text-layers)

  // Hard mode promises no station names; the street map's place names would give them away
  function applyText() {
    if (!map) return;
    if (!map.isStyleLoaded()) { map.once('idle', applyText); return; } // still fetching fonts or icons: try again when settled
    let shown = 0;
    for (const l of map.getStyle().layers ?? []) {
      if (l.type !== 'symbol') continue;
      map.setLayoutProperty(l.id, 'visibility', plain ? 'none' : 'visible');
      if (!plain) shown++;
    }
    textLayers = shown;
  }
  $effect(() => { void plain; applyText(); });
  let failed = $state(false);

  $effect(() => {
    let cancelled = false;
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const scheme = () => (document.documentElement.dataset.theme ?? (dark.matches ? 'dark' : 'light')) as 'light' | 'dark';
    const restyle = () => map?.setStyle(STYLE[scheme()]);
    (async () => {
      try {
        const [{ Map, setWorkerUrl }, worker] = await Promise.all([
          import('maplibre-gl'),
          // MapLibre 6 runs its tile parsing in a module worker; Vite must be told where that file is
          import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ]);
        if (cancelled) return;
        setWorkerUrl(worker.default);
        map = new Map({
          container: el, style: STYLE[scheme()], interactive: false, attributionControl: false,
          ...cameraFor(view, size, world), fadeDuration: 0,
        });
        map.on('load', () => { ready = true; applyText(); });
        map.on('style.load', applyText); // after a light/dark switch
        map.on('error', (e) => { console.warn('basemap error', e?.error?.message ?? e); if (!ready) failed = true; });
        dark.addEventListener('change', restyle);
      } catch {
        failed = true; // offline or blocked: the stations still work without the streets
      }
    })();
    return () => { cancelled = true; dark.removeEventListener('change', restyle); map?.remove(); map = null; };
  });

  $effect(() => {
    const cam = cameraFor(view, size, world);
    map?.resize();
    map?.jumpTo(cam);
  });
</script>

<div class="basemap" class:ready aria-hidden="true" data-text-layers={textLayers} bind:this={el}></div>
{#if !failed}
  <p class="credit">
    <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>
    <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>
    Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
  </p>
{/if}

<style>
  .basemap { position: absolute; inset: 0; opacity: 0; transition: opacity 300ms ease-out; pointer-events: none; }
  .basemap.ready { opacity: 0.9; }
  .credit {
    position: absolute; right: 6px; bottom: 4px; margin: 0; z-index: 1; font-size: 10px; line-height: 1.4;
    padding: 1px 6px; border-radius: 6px; background: color-mix(in srgb, var(--bg) 80%, transparent); color: var(--muted);
  }
  .credit a { color: inherit; }
  @media (prefers-reduced-motion: reduce) { .basemap { transition: none; } }
</style>
