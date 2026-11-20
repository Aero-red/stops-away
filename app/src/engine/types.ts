// Data shapes produced by tools/build_data.py (C1). The engine never touches the DOM.

export interface Station {
  id: string;
  name: string;
  aliases: string[];
  lat: number;
  lon: number;
  zone: string;
  suburb: string; // gazetted locality (Vicmap)
  lga: string;    // council area (Vicmap), used by the hint
  lines: string[]; // line ids
}

export interface Line {
  id: string;
  name: string;
  colour: string; // hex
}

/** Undirected edge between adjacent stations on one line. */
export interface Edge {
  a: string;
  b: string;
  line: string;
}

/** Two line names for one train: switching between them at `at` is not a change (e.g. Metro Tunnel). */
export interface Through {
  a: string;
  b: string;
  at: string;
}

export interface Network {
  stations: Station[];
  lines: Line[];
  edges: Edge[];
  through?: Through[];
}

export interface Route {
  path: string[];     // station ids, guess → target inclusive
  stops: number;      // path.length - 1
  changes: number;    // line changes along the path
  lines: string[];    // lines used, in travel order, no repeats in a row
}

export type HintId = 'zone' | 'line' | 'suburb' | 'letter' | 'region';
