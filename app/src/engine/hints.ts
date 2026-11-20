import type { HintId, Network } from './types';

const OCTANTS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];
const HUB = 'Flinders Street';

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dy = (b.lat - a.lat) * 111.32;
  const dx = (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return { dx, dy, d: Math.hypot(dx, dy) };
}

/** What a bought hint says about the target, or null when the data can't answer it. */
export function hintText(net: Network, targetId: string, hint: HintId): string | null {
  const t = net.stations.find((s) => s.id === targetId);
  if (!t) return null;
  switch (hint) {
    case 'zone':
      return !t.zone ? null : t.zone === '1/2' ? 'Zone 1/2 (the overlap)' : `Zone ${t.zone}`;
    case 'suburb':
      // council area, not suburb: most stations share their suburb's name, which would give it away
      return t.lga ? `Council area: ${t.lga}` : null;
    case 'letter':
      return `Starts with "${t.name[0]}"`;
    case 'line': {
      // the line with the fewest stations narrows the search most
      const size = (l: string) => net.stations.filter((s) => s.lines.includes(l)).length;
      const l = [...t.lines].sort((a, b) => size(a) - size(b) || a.localeCompare(b))[0];
      const name = net.lines.find((x) => x.id === l)?.name;
      return name ? `One line through it: ${name}` : null;
    }
    case 'region': {
      const hub = net.stations.find((s) => s.name === HUB);
      if (!hub) return null;
      const { dx, dy, d } = km(hub, t);
      if (d < 2) return 'In the city centre';
      const bearing = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 = north, clockwise
      const dir = OCTANTS[Math.round(((bearing + 360) % 360) / 45) % 8];
      // bands that still mean something for V/Line, out to Albury and Bairnsdale
      const band = d < 5 ? 'within 5 km' : d < 15 ? '5–15 km' : d < 30 ? '15–30 km'
        : d < 80 ? '30–80 km' : d < 150 ? '80–150 km' : 'over 150 km';
      return `${dir} of the city, ${band}`;
    }
  }
}
