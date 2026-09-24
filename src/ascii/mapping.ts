import { EDGE_CHARS } from './glyphAtlas';

/**
 * CPU mirror of the composite shader's character selection, used for text and
 * SVG export. Keep it in sync with `compositeFragment` in shaders.ts (the
 * scan, lens, noise and field effects are intentionally left out: exports
 * capture the clean frame).
 */

export interface ToneParams {
  brightness: number;
  contrast: number;
  gamma: number;
  threshold: number;
  dither: number;
  invert: boolean;
  fillSilhouette: boolean;
  edges: boolean;
  edgeThreshold: number;
  /** Cell width ÷ height, used to correct edge angles. */
  cellAspect: number;
}

export interface AsciiCell {
  char: string;
  /** Tone-mapped level 0..1 (after invert), drives gradient colors. */
  level: number;
  /** Cell color, sRGB bytes. */
  r: number;
  g: number;
  b: number;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function toneMap(l: number, p: Pick<ToneParams, 'gamma' | 'contrast' | 'brightness'>): number {
  let v = Math.pow(Math.min(1, Math.max(0, l)), 1 / p.gamma);
  v = (v - 0.5) * p.contrast + 0.5 + p.brightness;
  return Math.min(1, Math.max(0, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Index into `ramp` for one cell, or -1 when the cell stays empty. */
export function rampIndex(
  srgb: [number, number, number],
  coverage: number,
  x: number,
  y: number,
  rampCount: number,
  p: ToneParams,
): { index: number; level: number } {
  let level = toneMap(luma(srgb[0], srgb[1], srgb[2]), p);
  if (p.invert) level = 1 - level;
  level *= smoothstep(0, 0.5, coverage);
  level += ((BAYER4[(x % 4) + (y % 4) * 4] + 0.5) / 16 - 0.5) * (p.dither / rampCount);
  level = Math.min(1, Math.max(0, level));

  const covered = coverage > 0.02;
  let index = -1;
  if (covered && level > p.threshold) index = Math.min(rampCount - 1, Math.max(0, Math.floor(level * rampCount)));
  if (covered && p.fillSilhouette) index = Math.max(index, 1);
  return { index, level };
}

/**
 * Converts the GPU cell grid (RGBA8, bottom row first, as read back from the
 * cell render target) into rows of characters, top row first.
 */
export function cellsToAscii(
  data: Uint8Array,
  cols: number,
  rows: number,
  ramp: string[],
  p: ToneParams,
): AsciiCell[][] {
  const at = (x: number, y: number) => {
    const cx = Math.min(cols - 1, Math.max(0, x));
    const cy = Math.min(rows - 1, Math.max(0, y));
    return (cy * cols + cx) * 4;
  };
  const edgeSignal = (x: number, y: number) => {
    const i = at(x, y);
    const l = toneMap(luma(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255), p);
    return (data[i + 3] / 255) * (0.4 + 0.6 * l);
  };

  const out: AsciiCell[][] = [];
  for (let y = rows - 1; y >= 0; y--) {
    const line: AsciiCell[] = [];
    for (let x = 0; x < cols; x++) {
      const i = at(x, y);
      const srgb: [number, number, number] = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      const coverage = data[i + 3] / 255;
      const { index, level } = rampIndex(srgb, coverage, x, y, ramp.length, p);
      let char = index >= 0 ? ramp[index] : ' ';

      if (p.edges && coverage > 0.02) {
        const tl = edgeSignal(x - 1, y + 1);
        const tc = edgeSignal(x, y + 1);
        const tr = edgeSignal(x + 1, y + 1);
        const ml = edgeSignal(x - 1, y);
        const mr = edgeSignal(x + 1, y);
        const bl = edgeSignal(x - 1, y - 1);
        const bc = edgeSignal(x, y - 1);
        const br = edgeSignal(x + 1, y - 1);
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = tl + 2 * tc + tr - (bl + 2 * bc + br);
        if (Math.hypot(gx, gy) > p.edgeThreshold) {
          const angle = edgeAngle(gx, gy, p.cellAspect);
          char = EDGE_CHARS[Math.min(3, Math.floor(angle / (Math.PI / 4)))];
        }
      }

      line.push({ char, level, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    out.push(line);
  }
  return out;
}

/** atan2 folded to [0, π) and offset by π/8, matching the shader's quantization. */
export function edgeAngle(gx: number, gy: number, cellAspect: number): number {
  // Shader divides by cell size in pixels; only the ratio matters for the angle.
  const a = Math.atan2(gy, gx / cellAspect) + Math.PI / 8;
  return ((a % Math.PI) + Math.PI) % Math.PI;
}

/** Plain text with trailing spaces trimmed and empty border rows/columns removed. */
export function asciiToText(grid: AsciiCell[][], trim = true): string {
  let lines = grid.map((row) => row.map((c) => c.char).join(''));
  if (!trim) return lines.join('\n');

  const isBlank = (line: string) => line.trim().length === 0;
  while (lines.length && isBlank(lines[0])) lines.shift();
  while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
  if (!lines.length) return '';

  const indent = Math.min(...lines.filter((l) => !isBlank(l)).map((l) => l.length - l.trimStart().length));
  lines = lines.map((l) => l.slice(indent).trimEnd());
  return lines.join('\n');
}
