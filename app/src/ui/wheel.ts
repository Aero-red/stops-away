// Wheel and trackpad input on a desktop map: a mouse wheel zooms, a two-finger trackpad scroll
// moves the map, and a trackpad pinch (sent by browsers as ctrl + wheel) zooms at a hand-like rate.

export interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; wheelDeltaX?: number; wheelDeltaY?: number }
export type WheelIntent = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

const LINE = 33, PAGE = 800; // px per line or page step (Firefox sends lines)
const px = (d: number, mode: number) => d * (mode === 1 ? LINE : mode === 2 ? PAGE : 1);

/** Chrome and Safari on a Mac report wheelDelta = -3 x delta for a trackpad (and Magic Mouse), ±120 per notch for a wheel */
export function isTrackpad(e: WheelLike): boolean {
  if (e.wheelDeltaY || e.wheelDeltaX) return e.wheelDeltaY === -3 * e.deltaY && e.wheelDeltaX === -3 * e.deltaX;
  return e.deltaMode === 0 && e.deltaX !== 0;
}

/** streamTrackpad: the kind the current scroll started as, so one swipe never flips between pan and zoom */
export function wheelIntent(e: WheelLike, streamTrackpad?: boolean): WheelIntent {
  const dx = px(e.deltaX, e.deltaMode), dy = px(e.deltaY, e.deltaMode);
  if (e.ctrlKey) return { kind: 'zoom', factor: Math.exp(-dy * (Math.abs(dy) < 50 ? 0.01 : 0.0015)) }; // pinch, or ctrl + wheel
  if (streamTrackpad ?? isTrackpad(e)) return { kind: 'pan', dx, dy };
  return { kind: 'zoom', factor: Math.exp(-dy * 0.0015) };
}
