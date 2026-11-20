import type { Network, Route } from '../types';

export interface Feedback {
  stationId: string;
  correct: boolean;
  route: Route | null; // guess → target
}

/** Every mode has this shape, so the UI shell never changes when a mode is added. */
export interface Mode<S> {
  id: string;
  init(net: Network, opts: { seed: number; game?: number; targetId?: string }): S;
  guess(net: Network, state: S, stationId: string): S;
  isOver(state: S): boolean;
  feedback(state: S): Feedback[];
  share(state: S): string;
}
