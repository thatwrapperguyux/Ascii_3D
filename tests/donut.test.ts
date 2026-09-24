import { describe, expect, it } from 'vitest';
import { torusFrame } from '../src/ui/donut';

describe('torusFrame', () => {
  it('draws a torus of the requested size in the given glyphs', () => {
    const ramp = ' .:-=+*#%@';
    const frame = torusFrame(40, 16, 1, 0.5, ramp);
    const lines = frame.split('\n');
    expect(lines).toHaveLength(16);
    for (const line of lines) expect([...line]).toHaveLength(40);
    const used = new Set(frame.replace(/\n/g, ''));
    for (const c of used) expect(ramp).toContain(c);
    // Something is drawn, and not everything.
    expect(used.size).toBeGreaterThan(3);
    expect(frame.split(' ').length).toBeGreaterThan(40);
  });

  it('counts multi-byte glyphs as one column each', () => {
    const frame = torusFrame(30, 10, 0.4, 1.2, ' ⠁⠃⠇⡇⣇⣧⣷⣿');
    for (const line of frame.split('\n')) expect([...line]).toHaveLength(30);
  });
});
