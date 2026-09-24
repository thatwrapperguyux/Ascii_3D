import { describe, expect, it } from 'vitest';
import type { AsciiCell } from '../src/ascii/mapping';
import { buildSvg, glyphColorFn } from '../src/export/svg';
import { defaultSettings } from '../src/state/schema';

const cell = (char: string, level = 0.5, rgb = 128): AsciiCell => ({ char, level, r: rgb, g: rgb, b: rgb });

describe('glyphColorFn', () => {
  it('solid mode uses the glyph color', () => {
    const fn = glyphColorFn({ ...defaultSettings(), colorMode: 'mono', fg: '#123456' });
    expect(fn(cell('@'))).toBe('#123456');
  });

  it('gradient mode hits the stops at 0, 0.5 and 1', () => {
    const fn = glyphColorFn({ ...defaultSettings(), colorMode: 'gradient', gradA: '#000000', gradB: '#ff0000', gradC: '#ffffff' });
    expect(fn(cell('@', 0))).toBe('#000000');
    expect(fn(cell('@', 0.5))).toBe('#ff0000');
    expect(fn(cell('@', 1))).toBe('#ffffff');
  });
});

describe('buildSvg', () => {
  const base = {
    cellWidth: 6,
    cellHeight: 10,
    metrics: { fontPx: 8, stretch: 1, baseline: 8 },
    fontStack: '"JetBrains Mono", monospace',
    bold: false,
    colorOf: () => '#ffffff',
  };

  it('emits one text row per non-empty line and escapes XML', () => {
    const svg = buildSvg({
      ...base,
      background: '#000000',
      grid: [[cell('<'), cell('&'), cell(' ')], [cell(' '), cell(' '), cell(' ')], [cell('"'), cell(' '), cell('>')]],
    });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="30"')).toBe(true);
    expect(svg).toContain('<rect width="100%" height="100%" fill="#000000"/>');
    expect((svg.match(/<text /g) ?? []).length).toBe(2);
    expect(svg).toContain('&lt;&amp;');
    expect(svg).toContain('&quot;');
    const contents = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]).join('');
    expect(contents).toBe('&lt;&amp;&quot;&gt;');
    expect(contents).not.toMatch(/&(?!lt;|gt;|amp;|quot;|apos;)/);
  });

  it('omits the background when transparent', () => {
    expect(buildSvg({ ...base, background: null, grid: [[cell('@')]] })).not.toContain('<rect');
  });
});
