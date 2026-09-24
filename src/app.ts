import { NoToneMapping, SRGBColorSpace, Timer, Vector2, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FOX_URL } from 'virtual:sample-models';
import { AsciiPass } from './ascii/AsciiPass';
import { GLITCH_CHARS, ensureFontLoaded, fontStack, measureGlyphMetrics } from './ascii/glyphAtlas';
import { asciiToText, cellsToAscii, type AsciiCell } from './ascii/mapping';
import { CanvasRecorder, pickVideoFormat } from './export/recorder';
import { copyText, prepareSaving, saveFile, slug, timestamp } from './export/save';
import { buildSvg, glyphColorFn } from './export/svg';
import { ACCEPTED_FILES, ModelLoader, type LoadedModel } from './scene/loaders';
import { createProceduralSample, isSampleId, type SampleId } from './scene/samples';
import { Stage, type ModelSource, type PointerState } from './scene/stage';
import { PRESETS, presetSettings, randomLook } from './state/presets';
import {
  FONTS,
  defaultSettings,
  diffFromDefaults,
  rampFor,
  sanitizeSettings,
  type SettingKey,
  type Settings,
} from './state/schema';
import { encodeSettings, storeSettings } from './state/share';
import { SettingsStore } from './state/store';
import { formatCount } from './ui/dom';
import { Panel } from './ui/panel';
import { Toaster } from './ui/toast';

export interface AppDom {
  app: HTMLElement;
  stage: HTMLElement;
  viewport: HTMLElement;
  frame: HTMLElement;
  canvas: HTMLCanvasElement;
  inspector: HTMLElement;
  modelName: HTMLElement;
  telemetry: HTMLElement;
  hint: HTMLElement;
  dropzone: HTMLElement;
  loading: HTMLElement;
  loadingLabel: HTMLElement;
  loadingBar: HTMLElement;
  toasts: HTMLElement;
  fileInput: HTMLInputElement;
  uploadButton: HTMLButtonElement;
  snapshotButton: HTMLButtonElement;
  recordButton: HTMLButtonElement;
  recordTime: HTMLElement;
  fullscreenButton: HTMLButtonElement;
  hideButton: HTMLButtonElement;
  panelButton: HTMLButtonElement;
}

export interface AppOptions {
  /** Chrome-less mode for iframes: no inspector, overlays, storage or drag and drop. */
  embed: boolean;
  /** Orbit controls on/off (embeds can turn them off for background use). */
  orbit: boolean;
  /** Persist settings to localStorage. */
  persist: boolean;
  /** Offer "load from URL" and share links (not possible inside the Artifact sandbox). */
  networkFeatures: boolean;
}

interface LoadTask {
  loaded: LoadedModel;
  source: ModelSource;
  update?: (time: number) => void;
}

const LOOK_KEYS_CHANGING_ATLAS: SettingKey[] = ['charset', 'customChars', 'font', 'bold', 'glyphScale'];
const REVEAL_SECONDS = 1.2;

export class App {
  readonly store: SettingsStore;
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly asciiPass: AsciiPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly stage: Stage;
  private readonly loader: ModelLoader;
  private readonly toaster: Toaster;
  private readonly timer = new Timer();
  private readonly pointer: PointerState = { x: 0, y: 0, active: false };
  private readonly lens = { x: -1e4, y: -1e4, inside: false, cellX: -1, cellY: -1 };
  private panel: Panel | null = null;

  private pixelRatio = 1;
  private cssWidth = 1;
  private cssHeight = 1;
  private elapsed = 0;
  private scanPhase = 0;
  private revealStart = -1;
  private lensStrength = 0;
  private loadToken = 0;
  private loadingTimer = 0;
  private atlasToken = 0;
  private recorder: CanvasRecorder | null = null;
  private persistTimer = 0;
  private frames = 0;
  private fps = 0;
  private fpsSampleStart = 0;
  private lastTelemetry = 0;
  private exporting = false;
  /** Lowered automatically when the GPU can't keep up (see `adaptQuality`). */
  private maxPixelRatio = 2;
  private slowSamples = 0;

  constructor(
    private readonly dom: AppDom,
    initial: Settings,
    private readonly options: AppOptions,
  ) {
    this.store = new SettingsStore(initial);
    this.toaster = new Toaster(dom.toasts);

    this.renderer = new WebGLRenderer({
      canvas: dom.canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    this.stage = new Stage(this.renderer, dom.canvas);
    this.stage.controls.enabled = options.orbit;
    this.asciiPass = new AsciiPass(this.stage.scene, this.stage.camera);
    this.bloomPass = new UnrealBloomPass(new Vector2(256, 256), 0.5, 0.4, 0.2);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.asciiPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.loader = new ModelLoader(this.renderer);
    this.timer.connect(document);
    prepareSaving();
  }

  /** Builds the UI, starts rendering and loads the first model. */
  async start(initialModel: string | null): Promise<void> {
    const { dom, options } = this;
    dom.app.classList.toggle('embed', options.embed);
    dom.fileInput.accept = ACCEPTED_FILES;

    if (!options.embed) {
      this.panel = new Panel(dom.inspector, this.store, this.panelActions(), {
        urlLoading: options.networkFeatures,
        sharing: options.networkFeatures,
      });
      this.bindStageButtons();
      this.bindDragAndDrop();
      this.bindKeyboard();
    }
    this.bindPointer();

    this.stage.shadingLibrary.updateMaterials(this.store.value);
    this.stage.setFov(this.store.value.fov);
    this.applyLook(this.store.value);
    this.store.subscribe((changed, s) => this.onSettingsChange(changed, s));

    new ResizeObserver(() => this.resize()).observe(dom.viewport);
    matchMedia('(prefers-reduced-motion: reduce)').matches && this.setMotionPaused(true);
    this.resize();

    dom.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.toast('The graphics context was lost. Reload the page to continue.', 'error');
    });

    this.renderer.setAnimationLoop((time) => this.frame(time));
    await this.loadInitialModel(initialModel);
  }

  // ─── Settings ────────────────────────────────────────────

  private onSettingsChange(changed: ReadonlySet<SettingKey>, s: Readonly<Settings>): void {
    this.applyLook(s);
    const cellChanged = (changed.has('cellSize') || changed.has('charAspect')) && this.updateCellSize();
    if (!cellChanged && LOOK_KEYS_CHANGING_ATLAS.some((key) => changed.has(key))) this.refreshAtlas();
    if (changed.has('shading')) this.stage.setShading(s.shading);
    if (changed.has('baseColor') || changed.has('flatShading')) this.stage.shadingLibrary.updateMaterials(s);
    if (changed.has('fov')) this.stage.setFov(s.fov);
    if (changed.has('frame')) this.resize();
    if (this.options.persist) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = window.setTimeout(() => storeSettings(this.store.value), 300);
    }
  }

  private applyLook(s: Readonly<Settings>): void {
    this.asciiPass.applySettings(s);
    this.bloomPass.enabled = s.glow > 0.001;
    this.bloomPass.strength = s.glow;
    this.bloomPass.radius = s.glowRadius;
    this.bloomPass.threshold = s.glowThreshold;
    this.dom.frame.classList.toggle('transparent', s.transparentBg);
    const fill = s.frame === 'fill' && !s.transparentBg;
    this.dom.stage.style.background = fill ? s.bg : '';
    // Overlay text switches to dark ink when it sits on a light background.
    this.dom.stage.classList.toggle('light', fill && relativeLuminance(s.bg) > 0.45);
  }

  // ─── Layout ──────────────────────────────────────────────

  private resize(): void {
    const { viewport } = this.dom;
    const s = this.store.value;
    const framed = s.frame !== 'fill';
    viewport.classList.toggle('framed', framed);
    const style = getComputedStyle(viewport);
    let width = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let height = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (framed) {
      const [a, b] = s.frame.split(':').map(Number);
      const ratio = a / b;
      if (width / height > ratio) width = height * ratio;
      else height = width / ratio;
    }
    this.cssWidth = Math.max(1, Math.floor(width));
    this.cssHeight = Math.max(1, Math.floor(height));
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.applySize(this.pixelRatio);
  }

  private applySize(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.cssWidth, this.cssHeight);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.cssWidth, this.cssHeight);
    this.stage.setAspect(this.cssWidth / this.cssHeight);
    this.updateCellSize(ratio);
  }

  /**
   * Cell size in whole device pixels, so glyphs map 1:1 onto the screen.
   * Returns true when the atlas was rebuilt.
   */
  private updateCellSize(ratio = this.pixelRatio): boolean {
    const s = this.store.value;
    const height = Math.max(3, Math.round(s.cellSize * ratio));
    const width = Math.max(2, Math.round(height * s.charAspect));
    const changed = width !== this.asciiPass.cellWidth || height !== this.asciiPass.cellHeight;
    this.asciiPass.setCellSize(width, height);
    this.asciiPass.applySettings(s);
    if (!changed && this.asciiPass.atlas.layout.rampCount > 0) return false;
    this.refreshAtlas();
    return true;
  }

  /**
   * Rebuilds the glyph atlas right away (so it always matches the cell size),
   * then again once the chosen web font has finished loading.
   */
  private refreshAtlas(): void {
    const token = ++this.atlasToken;
    this.buildAtlas();
    const s = this.store.value;
    const family = FONTS[s.font].family;
    const spec = `${s.bold ? 700 : 400} 16px "${family}"`;
    const sample = rampFor(s).join('') + GLITCH_CHARS.join('');
    if (family && document.fonts && !document.fonts.check(spec, sample)) {
      void ensureFontLoaded(family, s.bold, sample).then(() => {
        if (token === this.atlasToken) this.buildAtlas();
      });
    }
  }

  private buildAtlas(): void {
    const s = this.store.value;
    this.asciiPass.atlas.build({
      ramp: rampFor(s),
      cellWidth: this.asciiPass.cellWidth,
      cellHeight: this.asciiPass.cellHeight,
      fontFamily: FONTS[s.font].family,
      bold: s.bold,
      glyphScale: s.glyphScale,
    });
    this.asciiPass.syncAtlas();
  }

  // ─── Frame loop ──────────────────────────────────────────

  private frame(time: number): void {
    if (this.exporting) return;
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.tick(dt);
    this.composer.render(dt);
    this.telemetry(time);
  }

  private tick(dt: number): void {
    const s = this.store.value;
    this.elapsed += dt;
    this.stage.update(dt, s, this.pointer);

    const u = this.asciiPass.uniforms;
    u.uTime.value = this.elapsed % 600;

    this.scanPhase += dt * s.scanSpeed;
    const span = 1.1 + 3 * s.scanWidth + 0.25;
    u.uScanPos.value = -0.05 + (this.scanPhase % 1) * span;

    if (this.revealStart >= 0) {
      const t = Math.min(1, (this.elapsed - this.revealStart) / REVEAL_SECONDS);
      u.uReveal.value = 1 - Math.pow(1 - t, 3);
      if (t >= 1) this.revealStart = -1;
    }

    const lensTarget = s.lens && this.lens.inside ? 1 : 0;
    this.lensStrength += (lensTarget - this.lensStrength) * (1 - Math.exp(-dt * 10));
    u.uLens.value = this.lensStrength;
    (u.uMouse.value as Vector2).set(this.lens.x, this.lens.y);
    u.uLensRadius.value = s.lensRadius * this.pixelRatio;
  }

  private telemetry(time: number): void {
    this.frames++;
    const span = time - this.fpsSampleStart;
    if (span >= 500) {
      // A long gap means the tab was hidden; don't judge performance from it.
      if (span < 2000) {
        this.fps = Math.round((this.frames * 1000) / span);
        this.adaptQuality();
      }
      this.frames = 0;
      this.fpsSampleStart = time;
    }
    if (this.options.embed || time - this.lastTelemetry < 250) return;
    this.lastTelemetry = time;

    const info = this.stage.info;
    const clip = this.stage.clipProgress();
    const item = (label: string, value: string, cls = '') => `<span class="${cls}">${label} <b>${value}</b></span>`;
    const parts = [
      `<span class="live${this.stage.motionPaused ? ' paused' : ''}">${this.recorder ? 'REC' : this.stage.motionPaused ? 'PAUSED' : 'LIVE'}</span>`,
      item('Cells', `${this.asciiPass.cols}×${this.asciiPass.rows}`),
      item('Glyphs', String(this.asciiPass.atlas.layout.rampCount)),
      item('FPS', String(this.fps)),
    ];
    if (info) parts.push(item('Tris', formatCount(info.triangles)));
    if (clip) parts.push(item(escapeHtml(clip.name), `${clip.time.toFixed(2)}/${clip.duration.toFixed(2)}s`));
    if (this.lens.inside && this.lens.cellX >= 0) {
      parts.push(item('Cursor', `${pad3(this.lens.cellX)}·${pad3(this.lens.cellY)}`));
    }
    this.dom.telemetry.innerHTML = parts.join('');
  }

  /**
   * On slow GPUs, step the device pixel ratio down (2 → 1.5 → 1). Cells are sized
   * in CSS pixels, so the look stays the same; glyphs just get less crisp.
   */
  private adaptQuality(): void {
    if (this.recorder || this.elapsed < 4 || this.pixelRatio <= 1) {
      this.slowSamples = 0;
      return;
    }
    this.slowSamples = this.fps < 30 ? this.slowSamples + 1 : 0;
    if (this.slowSamples >= 6) {
      this.slowSamples = 0;
      this.maxPixelRatio = Math.max(1, this.pixelRatio - 0.5);
      this.resize();
    }
  }

  // ─── Models ──────────────────────────────────────────────

  private async loadInitialModel(model: string | null): Promise<void> {
    if (model && model.startsWith('sample:') && isSampleId(model.slice(7))) {
      await this.loadSample(model.slice(7) as SampleId);
    } else if (model && this.options.networkFeatures) {
      const ok = await this.loadUrl(model);
      if (!ok) await this.loadSample('fox');
    } else {
      await this.loadSample('fox');
    }
  }

  async loadSample(id: SampleId): Promise<boolean> {
    if (id === 'fox') {
      return this.loadModel('Fox', async () => ({
        loaded: await this.loader.fromUrl(FOX_URL, (p) => this.showProgress(p), 'Fox'),
        source: { kind: 'sample', id },
      }));
    }
    return this.loadModel(id, async () => {
      const sample = createProceduralSample(id);
      return {
        loaded: { object: sample.object, clips: [], name: sample.name },
        source: { kind: 'sample', id },
        update: sample.update,
      };
    });
  }

  async loadFiles(files: File[]): Promise<boolean> {
    if (!files.length) return false;
    const look = files.find((f) => f.name.toLowerCase().endsWith('.json'));
    if (look && files.length === 1) {
      await this.loadLookFile(look);
      return true;
    }
    return this.loadModel(files[0].name, async () => ({
      loaded: await this.loader.fromFiles(files),
      source: { kind: 'file' },
    }));
  }

  async loadUrl(raw: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(raw, location.href);
    } catch {
      this.toast("That doesn't look like a valid URL.", 'error');
      return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      this.toast('Only http and https URLs can be loaded.', 'error');
      return false;
    }
    const href = url.href;
    return this.loadModel(decodeURIComponent(url.pathname.split('/').pop() || 'model'), async () => ({
      loaded: await this.loader.fromUrl(href, (p) => this.showProgress(p)),
      source: { kind: 'url', url: href },
    }));
  }

  private async loadModel(label: string, task: () => Promise<LoadTask>): Promise<boolean> {
    const token = ++this.loadToken;
    window.clearTimeout(this.loadingTimer);
    this.loadingTimer = window.setTimeout(() => {
      this.dom.loadingLabel.textContent = `Loading ${label}`;
      this.dom.loadingBar.textContent = '';
      this.dom.loading.hidden = false;
    }, 150);

    try {
      const result = await task();
      if (token !== this.loadToken) {
        this.stage.shadingLibrary.disposeModel(result.loaded.object);
        return false;
      }
      const s = this.store.value;
      const info = this.stage.setModel(result.loaded.object, result.loaded.clips, result.loaded.name, result.source, result.update);
      this.stage.setShading(s.shading);
      this.stage.shadingLibrary.updateMaterials(s);
      this.dom.modelName.textContent = `${info.name} — ${formatCount(info.triangles)} tris${info.clips.length ? ` · ${info.clips.length} clips` : ''}`;
      this.panel?.setModel(info, this.stage.activeClip);
      if (s.reveal) {
        this.revealStart = this.elapsed;
        this.asciiPass.uniforms.uReveal.value = 0;
      }
      return true;
    } catch (error) {
      if (token === this.loadToken) this.toast(errorMessage(error), 'error');
      return false;
    } finally {
      if (token === this.loadToken) {
        window.clearTimeout(this.loadingTimer);
        this.dom.loading.hidden = true;
      }
    }
  }

  private showProgress(fraction: number | null): void {
    if (fraction === null) return;
    const filled = Math.round(fraction * 16);
    this.dom.loadingBar.textContent = `${'▮'.repeat(filled)}${'▯'.repeat(16 - filled)} ${Math.round(fraction * 100)}%`;
  }

  // ─── Motion & view ───────────────────────────────────────

  private setMotionPaused(paused: boolean): void {
    this.stage.motionPaused = paused;
    this.panel?.setMotionPaused(paused);
  }

  private toggleUi(): void {
    const hidden = this.dom.app.classList.toggle('ui-hidden');
    this.dom.hideButton.setAttribute('aria-label', hidden ? 'Show interface' : 'Hide interface');
    this.dom.hideButton.title = hidden ? 'Show interface (H)' : 'Hide interface (H)';
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.dom.stage.requestFullscreen();
    } catch {
      this.toast("Full screen isn't available here.", 'error');
    }
  }

  private setPanelOpen(open: boolean): void {
    this.dom.app.classList.toggle('panel-open', open);
    this.dom.panelButton.setAttribute('aria-expanded', String(open));
  }

  // ─── Exports ─────────────────────────────────────────────

  private fileBase(): string {
    return `ascii3d-${slug(this.stage.info?.name ?? 'model')}-${timestamp()}`;
  }

  /** Renders one frame at `ratio` device pixels per CSS pixel and returns it as PNG. */
  private async renderStill(ratio: number): Promise<Blob> {
    this.exporting = true;
    try {
      if (ratio !== this.pixelRatio) this.applySize(ratio);
      this.composer.render(0);
      const blob = await new Promise<Blob | null>((resolve) => this.dom.canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser could not encode the image.');
      return blob;
    } finally {
      if (ratio !== this.pixelRatio) this.applySize(this.pixelRatio);
      this.exporting = false;
    }
  }

  async savePng(): Promise<void> {
    if (this.recorder) {
      // A high-resolution still resizes the canvas, which would corrupt the video.
      this.toast('Stop the recording before saving an image.', 'error');
      return;
    }
    // N× the on-screen resolution, capped by what the GPU can render in one pass.
    const gl = this.renderer.getContext();
    const maxSide = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const requested = this.panel?.pngScale ?? 1;
    const ratio = Math.min(this.pixelRatio * requested, maxSide / Math.max(this.cssWidth, this.cssHeight));
    try {
      const blob = await this.renderStill(ratio);
      const outcome = await saveFile(`${this.fileBase()}.png`, blob);
      if (outcome === 'saved') this.toast('PNG saved.');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  private loopSeconds(): number {
    const s = this.store.value;
    if (Math.abs(s.spin) >= 1) return Math.min(60, 360 / Math.abs(s.spin));
    const clip = this.stage.clipProgress();
    if (clip && s.animSpeed > 0 && clip.duration > 0) {
      const once = clip.duration / s.animSpeed;
      return once * Math.max(1, Math.ceil(3 / once));
    }
    return 6;
  }

  toggleRecording(): void {
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    const format = pickVideoFormat();
    if (!format) {
      this.toast("This browser can't record canvas video. Try Chrome, Edge or Firefox.", 'error');
      return;
    }
    const length = this.panel?.videoLength ?? 'loop';
    const seconds = length === 'loop' ? this.loopSeconds() : length;
    let recorder: CanvasRecorder;
    try {
      recorder = new CanvasRecorder(this.dom.canvas, seconds, format);
    } catch (error) {
      this.toast(errorMessage(error), 'error');
      return;
    }
    this.recorder = recorder;
    this.dom.recordButton.classList.add('recording');
    this.dom.recordTime.hidden = false;
    const tick = window.setInterval(() => {
      const label = `${formatSeconds(recorder.elapsed)} / ${formatSeconds(seconds)}`;
      this.dom.recordTime.textContent = label;
      this.panel?.setRecording(true, `Stop · ${label}`);
    }, 200);
    this.panel?.setRecording(true);

    recorder.finished
      .then((blob) => saveFile(`${this.fileBase()}.${recorder.extension}`, blob))
      .then((outcome) => outcome === 'saved' && this.toast(`Video saved (${recorder.extension.toUpperCase()}).`))
      .catch((error) => this.toast(errorMessage(error), 'error'))
      .finally(() => {
        window.clearInterval(tick);
        this.recorder = null;
        this.dom.recordButton.classList.remove('recording');
        this.dom.recordTime.hidden = true;
        this.panel?.setRecording(false);
      });
  }

  private asciiGrid(): AsciiCell[][] {
    const s = this.store.value;
    const data = this.asciiPass.readCells(this.renderer);
    return cellsToAscii(data, this.asciiPass.cols, this.asciiPass.rows, rampFor(s), {
      ...s,
      cellAspect: this.asciiPass.cellWidth / this.asciiPass.cellHeight,
    });
  }

  async copyAscii(): Promise<void> {
    const text = asciiToText(this.asciiGrid());
    if (!text) return this.toast('The frame is empty; there is nothing to copy.', 'error');
    const ok = await copyText(text);
    this.toast(ok ? `Copied ${text.split('\n').length} lines of ASCII.` : 'Copy was blocked. Use Save .txt instead.', ok ? 'info' : 'error');
  }

  async saveAscii(): Promise<void> {
    const text = asciiToText(this.asciiGrid());
    if (!text) return this.toast('The frame is empty; there is nothing to save.', 'error');
    await this.trySave(`${this.fileBase()}.txt`, text, 'Text saved.');
  }

  async saveSvg(): Promise<void> {
    const s = this.store.value;
    const ratio = this.pixelRatio;
    const cellWidth = this.asciiPass.cellWidth / ratio;
    const cellHeight = this.asciiPass.cellHeight / ratio;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return this.toast('Canvas 2D is unavailable, so the SVG could not be built.', 'error');
    const family = FONTS[s.font].family;
    const svg = buildSvg({
      grid: this.asciiGrid(),
      cellWidth,
      cellHeight,
      metrics: measureGlyphMetrics(ctx, family, s.bold, cellWidth, cellHeight, s.glyphScale),
      fontStack: fontStack(family),
      bold: s.bold,
      background: s.transparentBg ? null : s.bg,
      colorOf: glyphColorFn(s),
    });
    await this.trySave(`${this.fileBase()}.svg`, svg, 'SVG saved.');
  }

  private async trySave(filename: string, data: Blob | string, done: string): Promise<void> {
    try {
      if ((await saveFile(filename, data)) === 'saved') this.toast(done);
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async saveLook(): Promise<void> {
    const body = JSON.stringify({ app: 'ascii-3d-studio', version: 1, settings: this.store.value }, null, 2);
    await this.trySave(`ascii3d-look-${timestamp()}.json`, body, 'Look saved.');
  }

  private pickLookFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => input.files?.[0] && void this.loadLookFile(input.files[0]));
    input.click();
  }

  private async loadLookFile(file: File): Promise<void> {
    try {
      const json = JSON.parse(await file.text());
      const settings = sanitizeSettings(json && typeof json === 'object' && 'settings' in json ? json.settings : json);
      if (!Object.keys(settings).length) throw new Error('empty');
      this.store.set({ ...defaultSettings(), ...settings });
      this.toast(`Applied look from ${file.name}.`);
    } catch {
      this.toast(`${file.name} isn't a look file saved from this tool.`, 'error');
    }
  }

  private shareUrl(embed: boolean): URL {
    const url = new URL(location.pathname, location.origin);
    const source = this.stage.info?.source;
    if (source?.kind === 'sample') url.searchParams.set('model', `sample:${source.id}`);
    if (source?.kind === 'url') url.searchParams.set('model', source.url);
    if (embed) url.searchParams.set('embed', '1');
    const encoded = encodeSettings(diffFromDefaults(this.store.value));
    if (encoded !== encodeSettings({})) url.hash = `s=${encoded}`;
    return url;
  }

  private async copyShare(embed: boolean): Promise<void> {
    const url = this.shareUrl(embed).href;
    const payload = embed
      ? `<iframe src="${url}" title="ASCII 3D" style="width:100%;aspect-ratio:16/9;border:0" loading="lazy" allowfullscreen></iframe>`
      : url;
    const ok = await copyText(payload);
    if (!ok) return this.toast('Copy was blocked by the browser.', 'error');
    const local = this.stage.info?.source.kind === 'file';
    this.toast(
      local
        ? `${embed ? 'Embed code' : 'Link'} copied. Uploaded files aren't included: host the model (e.g. in /public/models) and load it by URL first.`
        : `${embed ? 'Embed code' : 'Link'} copied.`,
      'info',
      local ? 7000 : 3200,
    );
  }

  // ─── Input ───────────────────────────────────────────────

  private panelActions() {
    return {
      applyPreset: (id: string) => {
        const preset = PRESETS.find((p) => p.id === id);
        if (preset) this.store.set(presetSettings(preset));
      },
      randomize: () => this.store.set(randomLook(this.store.value)),
      resetAll: () => this.store.set(defaultSettings()),
      loadSample: (id: SampleId) => void this.loadSample(id),
      openFilePicker: () => this.dom.fileInput.click(),
      loadUrl: (url: string) => void this.loadUrl(url),
      playClip: (index: number) => this.stage.playClip(index),
      toggleMotion: () => this.setMotionPaused(!this.stage.motionPaused),
      resetView: () => this.stage.resetView(),
      savePng: () => void this.savePng(),
      toggleRecording: () => this.toggleRecording(),
      copyText: () => void this.copyAscii(),
      saveText: () => void this.saveAscii(),
      saveSvg: () => void this.saveSvg(),
      saveLook: () => void this.saveLook(),
      loadLook: () => this.pickLookFile(),
      copyShareLink: () => void this.copyShare(false),
      copyEmbedCode: () => void this.copyShare(true),
    };
  }

  private bindStageButtons(): void {
    const { dom } = this;
    dom.uploadButton.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', () => {
      const files = [...(dom.fileInput.files ?? [])];
      dom.fileInput.value = '';
      if (files.length) void this.loadFiles(files);
    });
    dom.snapshotButton.addEventListener('click', () => void this.savePng());
    dom.recordButton.addEventListener('click', () => this.toggleRecording());
    dom.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen());
    dom.hideButton.addEventListener('click', () => this.toggleUi());
    dom.panelButton.addEventListener('click', () => this.setPanelOpen(!dom.app.classList.contains('panel-open')));
    dom.canvas.addEventListener('pointerdown', () => this.setPanelOpen(false));

    // The orbit hint only matters until the first interaction.
    const dismissHint = () => dom.hint.classList.add('dismissed');
    dom.canvas.addEventListener('pointerdown', dismissHint, { once: true });
    window.setTimeout(dismissHint, 15_000);
  }

  private bindDragAndDrop(): void {
    const { dropzone } = this.dom;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      dropzone.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) dropzone.hidden = true;
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      dropzone.hidden = true;
      void this.loadFiles([...(e.dataTransfer?.files ?? [])]);
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === ' ') {
        if (target?.closest('button')) return;
        e.preventDefault();
        this.setMotionPaused(!this.stage.motionPaused);
      } else if (key === 'h') this.toggleUi();
      else if (key === 's') void this.savePng();
      else if (key === 'r') this.stage.resetView();
      else if (key === 'f') void this.toggleFullscreen();
      else if (key === 'u' || key === 'o') this.dom.fileInput.click();
      else if (key === 'x') this.store.set(randomLook(this.store.value));
      else if (key === 'escape') this.setPanelOpen(false);
      else if (/^[1-9]$/.test(key) && PRESETS[Number(key) - 1]) this.store.set(presetSettings(PRESETS[Number(key) - 1]));
    });
  }

  private bindPointer(): void {
    const { canvas } = this.dom;
    const update = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.pointer.x = Math.max(-1.5, Math.min(1.5, (x / rect.width) * 2 - 1));
      this.pointer.y = Math.max(-1.5, Math.min(1.5, 1 - (y / rect.height) * 2));
      this.pointer.active = true;
      this.lens.inside = e.target === canvas && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      this.lens.x = x * this.pixelRatio;
      this.lens.y = (rect.height - y) * this.pixelRatio;
      const offset = this.asciiPass.uniforms.uOffset.value as Vector2;
      this.lens.cellX = Math.floor((x * this.pixelRatio + offset.x) / this.asciiPass.cellWidth);
      this.lens.cellY = Math.floor((y * this.pixelRatio + offset.y) / this.asciiPass.cellHeight);
    };
    window.addEventListener('pointermove', update, { passive: true });
    window.addEventListener('pointerdown', update, { passive: true });
    const release = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') this.lens.inside = false;
    };
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget) {
        this.pointer.active = false;
        this.lens.inside = false;
      }
    });
  }

  private toast(message: string, kind: 'info' | 'error' = 'info', duration?: number): void {
    this.toaster.show(message, kind, duration);
  }
}

function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function pad3(n: number): string {
  return String(Math.max(0, n)).padStart(3, '0');
}

function formatSeconds(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
