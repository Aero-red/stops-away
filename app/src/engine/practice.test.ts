import { describe, expect, it } from 'vitest';
import { fixture as net } from './fixture';
import { practiceTarget } from './practice';

describe('themed practice: a target from one line', () => {
  it('only picks stations on the chosen line', () => {
    for (let i = 0; i < 50; i++) expect(net.stations.find((s) => s.id === practiceTarget(net, 'blue', () => i / 50))!.lines).toContain('blue');
  });
  it('any line when none is chosen', () => {
    const got = new Set(Array.from({ length: 50 }, (_, i) => practiceTarget(net, null, () => i / 50)));
    expect(got.size).toBe(net.stations.length);
  });
});
