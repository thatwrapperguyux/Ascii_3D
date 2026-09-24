import type { AsciiCell } from '../ascii/mapping';
import type { GlyphMetrics } from '../ascii/glyphAtlas';
import type { Settings } from '../state/schema';

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Per-cell glyph color, matching the composite shader's color modes. */
export function glyphColorFn(s: Readonly<Settings>): (cell: AsciiCell) => string {
  if (s.colorMode === 'mono') return () => s.fg;
  if (s.colorMode === 'gradient') {
    const a = hexToRgb(s.gradA);
    const b = hexToRgb(s.gradB);
    const c = hexToRgb(s.gradC);
    return ({ level }) => rgbToHex(...(level < 0.5 ? mix(a, b, level * 2) : mix(b, c, level * 2 - 1)));
  }
  return ({ r, g, b }) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let rgb: [number, number, number] = [l + (r - l) * s.saturation, l + (g - l) * s.saturation, l + (b - l) * s.saturation];
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 0.255);
    rgb = mix(rgb, [(rgb[0] / peak) * 255, (rgb[1] / peak) * 255, (rgb[2] / peak) * 255], s.colorBoost);
    // Quantize so neighbouring cells share <tspan> runs; keeps files small.
    return rgbToHex(...(rgb.map((v) => Math.round(v / 8) * 8) as [number, number, number]));
  };
}

const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export interface SvgOptions {
  grid: AsciiCell[][];
  /** Cell size in CSS pixels. */
  cellWidth: number;
  cellHeight: number;
  /** Glyph metrics in CSS pixels. */
  metrics: GlyphMetrics;
  fontStack: string;
  bold: boolean;
  background: string | null;
  colorOf: (cell: AsciiCell) => string;
}

/** Real text in an SVG: editable in Figma, Illustrator or a browser, and sharp at any size. */
export function buildSvg(o: SvgOptions): string {
  const rows = o.grid.length;
  const cols = rows ? o.grid[0].length : 0;
  const width = +(cols * o.cellWidth).toFixed(2);
  const height = +(rows * o.cellHeight).toFixed(2);
  const { fontPx, stretch, baseline } = o.metrics;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];
  if (o.background) out.push(`<rect width="100%" height="100%" fill="${o.background}"/>`);
  out.push(
    `<g font-family="${escapeXml(o.fontStack)}" font-size="${fontPx.toFixed(2)}" font-weight="${o.bold ? 700 : 400}" text-anchor="middle" transform="scale(${stretch.toFixed(4)} 1)">`,
  );

  o.grid.forEach((row, y) => {
    const spans: string[] = [];
    let runColor = '';
    let runChars = '';
    let runX: string[] = [];
    const flush = () => {
      if (runChars) spans.push(`<tspan x="${runX.join(' ')}" fill="${runColor}">${escapeXml(runChars)}</tspan>`);
      runChars = '';
      runX = [];
    };
    row.forEach((cell, x) => {
      if (cell.char === ' ') return;
      const fill = o.colorOf(cell);
      if (fill !== runColor) {
        flush();
        runColor = fill;
      }
      runChars += cell.char;
      runX.push((((x + 0.5) * o.cellWidth) / stretch).toFixed(2));
    });
    flush();
    if (spans.length) out.push(`<text y="${(y * o.cellHeight + baseline).toFixed(2)}">${spans.join('')}</text>`);
  });

  out.push('</g></svg>');
  return out.join('\n');
}
