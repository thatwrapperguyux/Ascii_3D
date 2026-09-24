import { describe, expect, it } from 'vitest';
import { asciiToText, cellsToAscii, edgeAngle, rampIndex, toneMap, type ToneParams } from '../src/ascii/mapping';

const tone: ToneParams = {
  brightness: 0,
  contrast: 1,
  gamma: 1,
  threshold: 0,
  dither: 0,
  invert: false,
  fillSilhouette: false,
  edges: false,
  edgeThreshold: 0.5,
  cellAspect: 1,
};

describe('toneMap', () => {
  it('is the identity at neutral settings', () => {
    for (const l of [0, 0.25, 0.5, 1]) expect(toneMap(l, tone)).toBeCloseTo(l);
  });

  it('applies contrast around mid grey and clamps', () => {
    expect(toneMap(0.75, { ...tone, contrast: 2 })).toBeCloseTo(1);
    expect(toneMap(0.5, { ...tone, contrast: 2 })).toBeCloseTo(0.5);
    expect(toneMap(0.1, { ...tone, brightness: -0.5 })).toBe(0);
  });

  it('gamma above 1 lifts midtones', () => {
    expect(toneMap(0.25, { ...tone, gamma: 2 })).toBeCloseTo(0.5);
  });
});

describe('rampIndex', () => {
  it('maps brightness to ramp position', () => {
    // Black is at (not above) the cutoff, so the cell stays empty, same as the shader.
    expect(rampIndex([0, 0, 0], 1, 0, 0, 10, tone).index).toBe(-1);
    expect(rampIndex([0.05, 0.05, 0.05], 1, 0, 0, 10, tone).index).toBe(0);
    expect(rampIndex([1, 1, 1], 1, 0, 0, 10, tone).index).toBe(9);
    expect(rampIndex([0.55, 0.55, 0.55], 1, 0, 0, 10, tone).index).toBe(5);
  });

  it('leaves uncovered cells empty', () => {
    expect(rampIndex([1, 1, 1], 0, 0, 0, 10, tone).index).toBe(-1);
  });

  it('respects the cutoff, invert and fill options', () => {
    expect(rampIndex([0.2, 0.2, 0.2], 1, 0, 0, 10, { ...tone, threshold: 0.5 }).index).toBe(-1);
    expect(rampIndex([0.2, 0.2, 0.2], 1, 0, 0, 10, { ...tone, threshold: 0.5, fillSilhouette: true }).index).toBe(1);
    expect(rampIndex([1, 1, 1], 1, 0, 0, 10, { ...tone, invert: true }).index).toBe(-1);
    expect(rampIndex([0, 0, 0], 1, 0, 0, 10, { ...tone, invert: true }).index).toBe(9);
  });
});

describe('edgeAngle', () => {
  it('quantizes gradients to | \\ - /', () => {
    const bucket = (gx: number, gy: number) => Math.floor(edgeAngle(gx, gy, 1) / (Math.PI / 4));
    expect(bucket(1, 0)).toBe(0); // horizontal change → vertical edge "|"
    expect(bucket(1, 1)).toBe(1); // "\"
    expect(bucket(0, 1)).toBe(2); // "-"
    expect(bucket(-1, 1)).toBe(3); // "/"
    expect(bucket(-1, 0)).toBe(0);
  });
});

/** Builds an RGBA8 grid (bottom row first, like the GPU readback) from rows written top-down. */
function grid(rows: number[][]): { data: Uint8Array; cols: number; rows: number } {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8Array(w * h * 4);
  rows.forEach((row, y) =>
    row.forEach((v, x) => {
      const i = ((h - 1 - y) * w + x) * 4;
      data.set(v < 0 ? [0, 0, 0, 0] : [v, v, v, 255], i);
    }),
  );
  return { data, cols: w, rows: h };
}

describe('cellsToAscii', () => {
  const ramp = [...' .:-=+*#%@'];

  it('returns rows top first', () => {
    const g = grid([
      [255, -1],
      [-1, 0],
    ]);
    const out = cellsToAscii(g.data, g.cols, g.rows, ramp, tone);
    expect(out.map((r) => r.map((c) => c.char).join(''))).toEqual(['@ ', '  ']);
  });

  it('draws edge glyphs around a silhouette', () => {
    const g = grid([
      [-1, -1, -1, -1, -1],
      [-1, 255, 255, 255, -1],
      [-1, 255, 255, 255, -1],
      [-1, 255, 255, 255, -1],
      [-1, -1, -1, -1, -1],
    ]);
    const text = cellsToAscii(g.data, g.cols, g.rows, ramp, { ...tone, edges: true }).map((r) =>
      r.map((c) => c.char).join(''),
    );
    expect(text[2][1]).toBe('|');
    expect(text[1][2]).toBe('-');
    expect(text[2][2]).toBe('@');
  });
});

describe('asciiToText', () => {
  it('trims empty borders and trailing spaces but keeps inner layout', () => {
    const cell = (char: string) => ({ char, level: 0, r: 0, g: 0, b: 0 });
    const rows = ['      ', '  @@  ', '   #  ', '      '].map((line) => [...line].map(cell));
    expect(asciiToText(rows)).toBe('@@\n #');
    expect(asciiToText(rows, false)).toBe('      \n  @@  \n   #  \n      ');
  });

  it('returns an empty string for an empty frame', () => {
    expect(asciiToText([[{ char: ' ', level: 0, r: 0, g: 0, b: 0 }]])).toBe('');
  });
});
