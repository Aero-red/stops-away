import { describe, expect, it } from 'vitest';
import { notesFor } from './sound';

describe('sound cues', () => {
  it('warmer rises, colder falls, a win climbs an arpeggio, first and same are a single note', () => {
    const [a, b] = notesFor('warmer'); expect(b).toBeGreaterThan(a);
    const [c, d] = notesFor('colder'); expect(d).toBeLessThan(c);
    const win = notesFor('hit');
    expect(win.length).toBeGreaterThanOrEqual(3);
    expect(win).toEqual([...win].sort((x, y) => x - y));
    expect(notesFor('first')).toHaveLength(1);
    expect(notesFor('same')).toHaveLength(1);
  });
});

import { CUE } from './sound';

describe('cue loudness (user: "no sound in my browser"; 0.12 sine blips were too faint on laptop speakers)', () => {
  it('peaks loud enough to hear and lasts long enough to notice', () => {
    expect(CUE.peak).toBeGreaterThanOrEqual(0.3);
    expect(CUE.peak).toBeLessThanOrEqual(0.5);   // still a cue, not a blast
    expect(CUE.length).toBeGreaterThanOrEqual(0.3);
    expect(CUE.wave).not.toBe('sine');            // a fuller tone carries on small speakers
  });
});
