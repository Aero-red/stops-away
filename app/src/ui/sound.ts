import type { Warmth } from '../engine/warmth';

/** Note frequencies (Hz) for each kind of feedback: a short, soft cue, never a fanfare. */
export function notesFor(w: Warmth): number[] {
  switch (w) {
    case 'warmer': return [523.25, 659.25];         // C5 -> E5, up
    case 'colder': return [440, 349.23];            // A4 -> F4, down
    case 'hit': return [523.25, 659.25, 783.99, 1046.5]; // C major arpeggio
    default: return [493.88];                       // B4, a neutral blip
  }
}

/** One note's shape: a quick attack, then a fade. Triangle carries on laptop and phone speakers
 *  where a quiet sine (the first version, peak 0.12) went unheard. */
export const CUE = { wave: 'triangle' as OscillatorType, peak: 0.35, length: 0.32, gap: 0.12 };

let ctx: AudioContext | null = null;

/** Make (or wake) the audio engine. Browsers only allow this during a tap or key press, so the app
 *  calls it on the player's first one; later cues (like the clock running out) then play too. */
export function unlock(): Promise<void> {
  try {
    // iPhone: web audio follows the ring/silent switch unless the page asks for playback (Safari 17+)
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') return ctx.resume().catch(() => {});
  } catch { /* no audio available */ }
  return Promise.resolve();
}

/** What the browser's audio is doing, for the help dialog: running, waiting for a tap, or none. */
export function audioState(): 'running' | 'waiting' | 'not started' | 'unavailable' {
  if (typeof AudioContext === 'undefined') return 'unavailable';
  if (!ctx) return 'not started';
  return ctx.state === 'running' ? 'running' : 'waiting';
}

/** Play the cue (only ever called after a player action, and only when sound is switched on). */
export function play(w: Warmth): void {
  try {
    void unlock();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    notesFor(w).forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = CUE.wave; o.frequency.value = f;
      const t = t0 + i * CUE.gap;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(CUE.peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + CUE.length);
      o.connect(g).connect(ctx!.destination);
      o.start(t); o.stop(t + CUE.length + 0.03);
    });
  } catch { /* no audio available: play on in silence */ }
}
