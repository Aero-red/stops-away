import type { Station } from './types';

export function normalise(s: string): string {
  return s.toLowerCase()
    .replace(/\bstation\b/g, '')
    .replace(/\bst\b\.?/g, 'street')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ranked station suggestions for typed input: exact name or alias, then
 * prefix, then word-prefix, then substring. Forgiving on case, punctuation,
 * "St"/"Street" and a trailing "station".
 */
export function suggest(input: string, stations: Station[], limit = 6): Station[] {
  const q = normalise(input);
  if (!q) return [];
  const ranked: { s: Station; r: number }[] = [];
  for (const s of stations) {
    const names = [s.name, ...s.aliases].map(normalise);
    let r = Infinity;
    for (const n of names) {
      if (n === q) r = Math.min(r, 0);
      else if (n.startsWith(q)) r = Math.min(r, 1);
      else if (n.split(' ').some((w) => w.startsWith(q))) r = Math.min(r, 2);
      else if (n.includes(q)) r = Math.min(r, 3);
    }
    if (r < Infinity) ranked.push({ s, r });
  }
  ranked.sort((a, b) => a.r - b.r || a.s.name.localeCompare(b.s.name));
  return ranked.slice(0, limit).map((x) => x.s);
}
