import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// A production build registers an offline worker (public/sw.js) that serves cached files first.
// If one was ever installed on the dev address it keeps serving old modules after every edit and
// restart, so the dev page removes any worker and its caches before the app loads.
function devClearsServiceWorkers() {
  return {
    name: 'dev-clears-service-workers',
    apply: 'serve' as const,
    transformIndexHtml: () => [{
      tag: 'script', injectTo: 'head-prepend' as const, attrs: { 'data-dev-sw-cleanup': '' },
      children: `if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(async (rs) => {
  if (!rs.length) return;
  await Promise.all(rs.map((r) => r.unregister()));
  if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  location.reload();
});`,
    }],
  };
}

// base './': relative asset paths, so the build works under a GitHub Pages subpath
export default defineConfig({
  base: './',
  plugins: [svelte(), devClearsServiceWorkers()],
  // MapLibre 6 ships its own module worker; pre-bundling breaks the worker's URL in dev
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
