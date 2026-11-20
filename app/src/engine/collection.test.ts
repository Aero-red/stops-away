import { describe, expect, it } from 'vitest';
import { fixture as net } from './fixture';
import { emptyCollection, record, lineProgress } from './collection';

describe('Station collection: every station you have met, across games', () => {
  it('records guessed stations as seen and the answer as found, without duplicates', () => {
    let c = record(emptyCollection(), ['A', 'B', 'C'], 'C');
    c = record(c, ['B', 'D'], null);
    expect([...c.seen].sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(c.found).toEqual(['C']);
    c = record(c, ['C'], 'C');
    expect(c.found).toEqual(['C']); // found once
  });
  it('a found station also counts as seen', () => {
    expect(record(emptyCollection(), [], 'E').seen).toEqual(['E']);
  });
  it('reports progress per line', () => {
    const c = record(emptyCollection(), ['A', 'B', 'F'], 'F');
    const p = Object.fromEntries(lineProgress(c, net).map((x) => [x.line, [x.seen, x.found, x.total]]));
    expect(p.red).toEqual([2, 0, 5]);
    expect(p.blue).toEqual([1, 1, 3]);
  });
});
