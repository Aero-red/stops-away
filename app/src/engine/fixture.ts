import type { Network, Station } from './types';

// Small made-up network for tests and the prototype. NOT real Melbourne data:
// real data comes from tools/build_data.py (C1) once H1 confirms the source.
//
//   A ── B ── C ── D ── E        (red)
//             │
//             F ── G             (blue: C ── F ── G)
//   A ═══════════ G              (green express: A ── G, one stop)

const st = (id: string, name: string, lines: string[], aliases: string[] = []): Station => ({
  id, name, aliases, lat: 0, lon: 0, zone: '', suburb: '', lga: '', lines,
});

export const fixture: Network = {
  stations: [
    st('A', 'Alpha Street', ['red', 'green'], ['ALS']),
    st('B', 'Bravo', ['red']),
    st('C', 'Central', ['red', 'blue']),
    st('D', 'Delta', ['red']),
    st('E', 'Echo Park', ['red']),
    st('F', 'Foxtrot', ['blue']),
    st('G', 'Golf', ['blue', 'green']),
  ],
  lines: [
    { id: 'red', name: 'Red', colour: '#d33' },
    { id: 'blue', name: 'Blue', colour: '#36c' },
    { id: 'green', name: 'Green', colour: '#2a2' },
  ],
  edges: [
    { a: 'A', b: 'B', line: 'red' }, { a: 'B', b: 'C', line: 'red' },
    { a: 'C', b: 'D', line: 'red' }, { a: 'D', b: 'E', line: 'red' },
    { a: 'C', b: 'F', line: 'blue' }, { a: 'F', b: 'G', line: 'blue' },
    { a: 'A', b: 'G', line: 'green' },
  ],
};
