import type { View } from './viewport';

/** How geo.json's map units relate to Web Mercator world pixels (zoom 0, 256 px world):
 *  unit = (world px - o) * scale. Written by tools/layout.py. */
export interface World { scale: number; ox: number; oy: number }

/** Map units -> [longitude, latitude] (inverse Web Mercator). */
export function unitToLngLat(u: number, v: number, w: World): [number, number] {
  const wx = u / w.scale + w.ox;
  const wy = v / w.scale + w.oy;
  const lng = (wx / 256) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / 256))) * 180) / Math.PI;
  return [lng, lat];
}

/** The MapLibre camera that shows exactly our SVG view. MapLibre draws 512 px tiles, so at zoom z
 *  one world pixel (of the 256 px world) is 2^(z+1) screen px; one map unit is k = 2^(z+1) / scale. */
export function cameraFor(v: View, size: { w: number; h: number }, w: World): { center: [number, number]; zoom: number } {
  const k = size.w / v.w;
  return { center: unitToLngLat(v.x + v.w / 2, v.y + v.h / 2, w), zoom: Math.log2(k * w.scale) - 1 };
}
