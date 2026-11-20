import { describe, expect, it } from 'vitest';
import { fixture as net } from './fixture';
import { dailyMode, practiceMode, rollover, useHint } from './modes/daily';

const day = (n: number) => dailyMode.init(net, { seed: 1, game: n, targetId: 'C' });

describe('rollover at Melbourne midnight (review R1 finding 1)', () => {
  it('stays on the same day', () => {
    expect(rollover(day(10), 10)).toBe(false);
  });
  it("moves to today's puzzle when yesterday's is finished or untouched", () => {
    expect(rollover(dailyMode.guess(net, day(9), 'C'), 10)).toBe(true); // solved yesterday
    expect(rollover(day(9), 10)).toBe(true);                             // opened, never played
  });
  it("lets you finish yesterday's game if you are in the middle of it", () => {
    expect(rollover(dailyMode.guess(net, day(9), 'A'), 10)).toBe(false);
    expect(rollover(useHint(net, day(9), 'letter'), 10)).toBe(false);
  });
  it('never moves a practice game', () => {
    expect(rollover(practiceMode.init(net, { seed: 1, targetId: 'C' }), 10)).toBe(false);
  });
});
