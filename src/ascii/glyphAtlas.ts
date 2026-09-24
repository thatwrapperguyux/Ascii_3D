import { CanvasTexture, NearestFilter, NoColorSpace } from 'three';

export const EDGE_CHARS = ['|', '\\', '-', '/'] as const;
/** Glyphs used for scrambles, the scan beam and the background field. ASCII only, so every font has them. */
export const GLITCH_CHARS = [...'01<>/\\|{}[]#$%&*+=?!;:~^'];

export interface AtlasLayout {
  /** Index of the first edge glyph (| \ - /). */
  edgeBase: number;
  /** Index of the first glitch glyph. */
  glitchBase: number;
  glitchCount: number;
  /** Number of density-ramp glyphs (they come first in the atlas). */
  rampCount: number;
  /** Glyphs per atlas row. */
  columns: number;
}

export interface AtlasOptions {
  ramp: string[];
  cellWidth: number;
  cellHeight: number;
  fontFamily: string;
  bold: boolean;
  glyphScale: number;
}

/**
 * Shade blocks are drawn as pixel patterns instead of font glyphs: font block
 * glyphs rarely span the full line box, which leaves gaps between rows.
 */
const BLOCK_PATTERNS: Record<string, (x: number, y: number) => boolean> = {
  '█': () => true,
  '▓': (x, y) => (x + 2 * y) % 4 !== 0,
  '▒': (x, y) => (x + y) % 2 === 0,
  '░': (x, y) => (x + 2 * y) % 4 === 0,
};

const FALLBACK_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

export function fontStack(family: string): string {
  return family ? `"${family}", ${FALLBACK_STACK}` : FALLBACK_STACK;
}

function fontString(family: string, bold: boolean, px: number): string {
  return `${bold ? 700 : 400} ${px}px ${fontStack(family)}`;
}

export interface GlyphMetrics {
  /** Font size in pixels. */
  fontPx: number;
  /** Horizontal scale that makes one glyph advance span the cell width. */
  stretch: number;
  /** Baseline offset from the top of the cell. */
  baseline: number;
}

/**
 * Sizes the font so its line box fills the cell height (times `glyphScale`)
 * and centers it vertically. Shared by the atlas and the SVG export.
 */
export function measureGlyphMetrics(
  ctx: CanvasRenderingContext2D,
  family: string,
  bold: boolean,
  cellWidth: number,
  cellHeight: number,
  glyphScale: number,
): GlyphMetrics {
  ctx.font = fontString(family, bold, 100);
  const ref = ctx.measureText('M');
  const ascent = ref.fontBoundingBoxAscent || 80;
  const descent = ref.fontBoundingBoxDescent || 20;
  const advance = ref.width || 60;
  const fontPx = (cellHeight * glyphScale * 100) / (ascent + descent);
  const stretch = (cellWidth * glyphScale) / ((advance * fontPx) / 100);
  const baseline = (cellHeight - ((ascent + descent) * fontPx) / 100) / 2 + (ascent * fontPx) / 100;
  return { fontPx, stretch, baseline };
}

/**
 * Waits (briefly) for a web font so the atlas isn't rasterized with a fallback
 * face. Resolves regardless of the outcome: offline or blocked fonts fall back.
 */
export async function ensureFontLoaded(family: string, bold: boolean, sample: string): Promise<void> {
  if (!family || typeof document === 'undefined' || !document.fonts) return;
  const spec = `${bold ? 700 : 400} 32px "${family}"`;
  try {
    await Promise.race([
      document.fonts.load(spec, sample || 'A'),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // Fall back silently.
  }
}

/**
 * Rasterizes the glyph set into a texture whose glyph boxes are exactly one
 * screen cell in device pixels, so the composite shader can copy glyph pixels
 * 1:1 (texelFetch) and text stays crisp at every cell size.
 */
export class GlyphAtlas {
  texture: CanvasTexture;
  layout: AtlasLayout = { edgeBase: 0, glitchBase: 0, glitchCount: 0, rampCount: 0, columns: 1 };
  private readonly canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 1;
    this.texture = this.makeTexture();
  }

  private makeTexture(): CanvasTexture {
    const texture = new CanvasTexture(this.canvas);
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.colorSpace = NoColorSpace;
    return texture;
  }

  build(options: AtlasOptions): void {
    const { ramp, cellWidth: cw, cellHeight: ch } = options;
    const glyphs = [...ramp, ...EDGE_CHARS, ...GLITCH_CHARS];
    const columns = Math.max(1, Math.min(glyphs.length, 16, Math.floor(8192 / cw)));
    const rows = Math.ceil(glyphs.length / columns);
    const width = columns * cw;
    const height = rows * ch;

    const resized = this.canvas.width !== width || this.canvas.height !== height;
    this.canvas.width = width;
    this.canvas.height = height;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable, so glyphs cannot be drawn.');
    ctx.clearRect(0, 0, width, height);

    const { fontPx, stretch, baseline } = measureGlyphMetrics(
      ctx,
      options.fontFamily,
      options.bold,
      cw,
      ch,
      options.glyphScale,
    );
    ctx.font = fontString(options.fontFamily, options.bold, fontPx);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Pattern unit grows with the cell so shades stay visible on high-DPI screens.
    const unit = Math.max(1, Math.round(ch / 10));
    glyphs.forEach((glyph, i) => {
      if (glyph === ' ') return;
      const x = (i % columns) * cw;
      const y = Math.floor(i / columns) * ch;
      const pattern = BLOCK_PATTERNS[glyph];
      if (pattern) {
        const bw = Math.max(1, Math.round(cw * options.glyphScale));
        const bh = Math.max(1, Math.round(ch * options.glyphScale));
        const x0 = x + Math.floor((cw - bw) / 2);
        const y0 = y + Math.floor((ch - bh) / 2);
        for (let py = 0; py < bh; py += unit) {
          for (let px = 0; px < bw; px += unit) {
            if (pattern(px / unit, py / unit)) {
              ctx.fillRect(x0 + px, y0 + py, Math.min(unit, bw - px), Math.min(unit, bh - py));
            }
          }
        }
        return;
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cw, ch);
      ctx.clip();
      ctx.translate(x + cw / 2, y + baseline);
      ctx.scale(stretch, 1);
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    });

    if (resized) {
      // Texture storage is immutable in WebGL2; a new size needs a new texture.
      this.texture.dispose();
      this.texture = this.makeTexture();
    }
    this.texture.needsUpdate = true;

    this.layout = {
      rampCount: ramp.length,
      edgeBase: ramp.length,
      glitchBase: ramp.length + EDGE_CHARS.length,
      glitchCount: GLITCH_CHARS.length,
      columns,
    };
  }

  dispose(): void {
    this.texture.dispose();
  }
}
