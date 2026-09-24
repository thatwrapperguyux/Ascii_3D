import {
  Color,
  HalfFloatType,
  NearestFilter,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type IUniform,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Settings } from '../state/schema';
import { GlyphAtlas } from './glyphAtlas';
import { compositeFragment, fullscreenVertex, reduceFragment } from './shaders';

const SCAN_DIRECTION_INDEX = { down: 0, up: 1, right: 2, left: 3, radial: 4 } as const;
const COLOR_MODE_INDEX = { original: 0, mono: 1, gradient: 2 } as const;

/** Samples per cell edge used for the scene render (the reduce shader takes a 4×4 grid). */
const SAMPLES_PER_CELL = 4;

type Uniforms = Record<string, IUniform>;

/**
 * Renders the scene and turns it into glyphs:
 * scene → low-res scene target → one texel per cell → full-res glyph composite.
 */
export class AsciiPass extends Pass {
  readonly atlas = new GlyphAtlas();
  cols = 1;
  rows = 1;
  cellWidth = 7;
  cellHeight = 11;

  private width = 1;
  private height = 1;
  private readonly sceneTarget: WebGLRenderTarget;
  private readonly cellTarget: WebGLRenderTarget;
  private readonly reduceQuad: FullScreenQuad;
  private readonly compositeQuad: FullScreenQuad;
  private readonly reduceUniforms: Uniforms;
  readonly uniforms: Uniforms;
  private readonly previousClear = new Color();

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    super();

    this.sceneTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.cellTarget = new WebGLRenderTarget(1, 1, {
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });

    this.reduceUniforms = {
      tScene: { value: this.sceneTarget.texture },
      uCell: { value: new Vector2() },
      uOffset: { value: new Vector2() },
      uViewport: { value: new Vector2(1, 1) },
      uExposure: { value: 1 },
    };

    this.uniforms = {
      tCells: { value: this.cellTarget.texture },
      tAtlas: { value: this.atlas.texture },
      uGrid: { value: new Vector2(1, 1) },
      uCell: this.reduceUniforms.uCell,
      uOffset: this.reduceUniforms.uOffset,
      uViewport: this.reduceUniforms.uViewport,
      uTime: { value: 0 },
      uAtlasColumns: { value: 1 },
      uRampCount: { value: 2 },
      uEdgeBase: { value: 0 },
      uGlitchBase: { value: 0 },
      uGlitchCount: { value: 1 },
      uBrightness: { value: 0 },
      uContrast: { value: 1 },
      uGamma: { value: 1 },
      uThreshold: { value: 0 },
      uDither: { value: 0 },
      uInvert: { value: false },
      uFill: { value: false },
      uEdges: { value: false },
      uEdgeThreshold: { value: 0.5 },
      uColorMode: { value: 2 },
      uFg: { value: new Color() },
      uGradA: { value: new Vector3() },
      uGradB: { value: new Vector3() },
      uGradC: { value: new Vector3() },
      uColorBoost: { value: 0.5 },
      uSaturation: { value: 1 },
      uBg: { value: new Color() },
      uTransparent: { value: false },
      uAccent: { value: new Color() },
      uScan: { value: false },
      uScanDir: { value: 0 },
      uScanPos: { value: -1 },
      uScanWidth: { value: 0.2 },
      uScanFront: { value: 0.02 },
      uScanGlitch: { value: 0.5 },
      uLens: { value: 0 },
      uMouse: { value: new Vector2(-1e4, -1e4) },
      uLensRadius: { value: 100 },
      uNoise: { value: 0 },
      uField: { value: 0 },
      uGridLines: { value: 0 },
      uCrt: { value: 0 },
      uVignette: { value: 0 },
      uReveal: { value: 1 },
    };

    this.reduceQuad = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: this.reduceUniforms,
        vertexShader: fullscreenVertex,
        fragmentShader: reduceFragment,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.compositeQuad = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: fullscreenVertex,
        fragmentShader: compositeFragment,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  /** Cell size in device pixels. Both must be whole numbers so glyphs map 1:1 onto pixels. */
  setCellSize(width: number, height: number): void {
    this.cellWidth = Math.max(2, Math.round(width));
    this.cellHeight = Math.max(3, Math.round(height));
    this.updateLayout();
  }

  override setSize(width: number, height: number): void {
    // Render targets truncate fractional sizes (e.g. at 1.25× DPR); match them exactly.
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.updateLayout();
  }

  /** Call after rebuilding the atlas so the shader picks up the new texture and layout. */
  syncAtlas(): void {
    const { layout, texture } = this.atlas;
    this.uniforms.tAtlas.value = texture;
    this.uniforms.uAtlasColumns.value = layout.columns;
    this.uniforms.uRampCount.value = layout.rampCount;
    this.uniforms.uEdgeBase.value = layout.edgeBase;
    this.uniforms.uGlitchBase.value = layout.glitchBase;
    this.uniforms.uGlitchCount.value = layout.glitchCount;
  }

  private updateLayout(): void {
    const { width, height, cellWidth, cellHeight } = this;
    this.cols = Math.ceil(width / cellWidth);
    this.rows = Math.ceil(height / cellHeight);
    // Center the grid; partial cells are split evenly between the edges.
    const offsetX = Math.floor((this.cols * cellWidth - width) / 2);
    const offsetY = Math.floor((this.rows * cellHeight - height) / 2);

    // The scene only needs ~4 samples per cell edge, never more than the output resolution.
    const scale = Math.min(1, SAMPLES_PER_CELL / Math.min(cellWidth, cellHeight));
    this.sceneTarget.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    this.cellTarget.setSize(this.cols, this.rows);

    (this.uniforms.uGrid.value as Vector2).set(this.cols, this.rows);
    (this.reduceUniforms.uCell.value as Vector2).set(cellWidth, cellHeight);
    (this.reduceUniforms.uOffset.value as Vector2).set(offsetX, offsetY);
    (this.reduceUniforms.uViewport.value as Vector2).set(width, height);
  }

  /** Pushes the look-related settings into shader uniforms. Cheap; safe to call on every change. */
  applySettings(s: Readonly<Settings>): void {
    const u = this.uniforms;
    this.reduceUniforms.uExposure.value = s.exposure;
    u.uBrightness.value = s.brightness;
    u.uContrast.value = s.contrast;
    u.uGamma.value = s.gamma;
    u.uThreshold.value = s.threshold;
    u.uDither.value = s.dither;
    u.uInvert.value = s.invert;
    u.uFill.value = s.fillSilhouette;
    u.uEdges.value = s.edges;
    u.uEdgeThreshold.value = s.edgeThreshold;
    u.uColorMode.value = COLOR_MODE_INDEX[s.colorMode];
    (u.uFg.value as Color).set(s.fg);
    setSrgbVector(u.uGradA.value as Vector3, s.gradA);
    setSrgbVector(u.uGradB.value as Vector3, s.gradB);
    setSrgbVector(u.uGradC.value as Vector3, s.gradC);
    u.uColorBoost.value = s.colorBoost;
    u.uSaturation.value = s.saturation;
    (u.uBg.value as Color).set(s.bg);
    u.uTransparent.value = s.transparentBg;
    (u.uAccent.value as Color).set(s.accent);
    u.uScan.value = s.scan;
    u.uScanDir.value = SCAN_DIRECTION_INDEX[s.scanDirection];
    u.uScanWidth.value = s.scanWidth;
    u.uScanGlitch.value = s.scanGlitch;
    u.uNoise.value = s.noise;
    u.uField.value = s.field;
    u.uGridLines.value = s.grid;
    u.uCrt.value = s.crt;
    u.uVignette.value = s.vignette;
    this.updateScanFront(s.scanDirection);
  }

  /** Thickness of the scan front, roughly one cell along the sweep direction. */
  private updateScanFront(direction: Settings['scanDirection']): void {
    const horizontal = direction === 'left' || direction === 'right';
    this.uniforms.uScanFront.value = horizontal
      ? (this.cellWidth * 1.5) / this.width
      : (this.cellHeight * 1.5) / this.height;
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget): void {
    renderer.getClearColor(this.previousClear);
    const previousAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(this.sceneTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(this.cellTarget);
    this.reduceQuad.render(renderer);

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);

    renderer.setClearColor(this.previousClear, previousAlpha);
  }

  /** Reads the per-cell grid (RGBA8, bottom row first) of the most recent frame. */
  readCells(renderer: WebGLRenderer): Uint8Array {
    const buffer = new Uint8Array(this.cols * this.rows * 4);
    renderer.readRenderTargetPixels(this.cellTarget, 0, 0, this.cols, this.rows, buffer);
    return buffer;
  }

  override dispose(): void {
    this.sceneTarget.dispose();
    this.cellTarget.dispose();
    this.reduceQuad.dispose();
    this.compositeQuad.dispose();
    this.atlas.dispose();
  }
}

const tmpColor = new Color();

/** Gradient stops are interpolated in sRGB space in the shader (perceptually even). */
function setSrgbVector(target: Vector3, hex: string): void {
  tmpColor.set(hex);
  const srgb = { r: 0, g: 0, b: 0 };
  tmpColor.getRGB(srgb, SRGBColorSpace);
  target.set(srgb.r, srgb.g, srgb.b);
}
