import type { Network, Station } from './types';

/** A Regional practice target: a country station, never one that metro trains also stop at. */
export function regionalTarget(reg: Network, metro: Network, rand: () => number): Station {
  const metroIds = new Set(metro.stations.map((s) => s.id));
  const country = reg.stations.filter((s) => !metroIds.has(s.id));
  return country[Math.min(country.length - 1, Math.floor(rand() * country.length))];
}
