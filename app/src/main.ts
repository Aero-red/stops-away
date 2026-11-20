import { mount } from 'svelte'
// Overpass (SIL OFL 1.1), signage-style lettering for a transit map; bundled, so it works offline
import '@fontsource/overpass/latin-400.css'
import '@fontsource/overpass/latin-600.css'
import '@fontsource/overpass/latin-800.css'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

// offline play in production builds only (a dev-server worker would cache stale modules)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* still playable online */ })
}

export default app
