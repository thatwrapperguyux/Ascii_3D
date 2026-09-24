import { NoToneMapping, SRGBColorSpace, Timer, Vector2, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FOX_URL } from 'virtual:sample-models';
import { AsciiPass } from './ascii/AsciiPass';
import { GLITCH_CHARS, ensureFontLoaded, fontStack, measureGlyphMetrics } from './ascii/glyphAtlas';
import { asciiToText, cellsToAscii, type AsciiCell } from './ascii/mapping';
import {
  base64ToBytes,
  buildEmbedPage,
  bytesToBase64,
  collectAppCode,
  glbIsPortable,
  iframeCode,
  type EmbedConfig,
  type EmbedModel,
} from './export/embed';
import { CanvasRecorder, pickVideoFormat } from './export/recorder';
import { copyText, prepareSaving, saveFile, slug } from './export/save';
import { buildSvg, glyphColorFn } from './export/svg';
import { buildZip, type ZipEntry } from './export/zip';
import { ACCEPTED_FILES, ModelLoader, type LoadedModel } from './scene/loaders';
import { createProceduralSample, isSampleId, type SampleId } from './scene/samples';
import { Stage, type FrameRect, type ModelSource, type PointerState } from './scene/stage';
import { THEME_GROUND, effectiveSettings, relativeLuminance, type UiTheme } from './state/look';
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
import { encodeSettings, storeSettings, writePref } from './state/share';
import { SettingsStore } from './state/store';
import { spinTorus } from './ui/donut';
import { formatCount, paintIcons, svg } from './ui/dom';
import { LOGO_MARK } from './ui/icons';
import { Panel, type PanelActions } from './ui/panel';
import { wireSound } from './ui/sound';
import { Toaster } from './ui/toast';
import { Tour } from './ui/tour';

export interface AppDom {
  app: HTMLElement;
  stage: HTMLElement;
  viewport: HTMLElement;
  canvas: HTMLCanvasElement;
  railLeft: HTMLElement;
  railRight: HTMLElement;
  stagebar: HTMLElement;
  framemarks: HTMLElement;
  telemetry: HTMLElement;
  themeSwitch: HTMLElement;
  hideButton: HTMLButtonElement;
  fullscreenButton: HTMLButtonElement;
  soundButton: HTMLButtonElement;
  cta: HTMLElement;
  randomButton: HTMLButtonElement;
  recordButton: HTMLButtonElement;
  recordTitle: HTMLElement;
  recordSub: HTMLElement;
  loading: HTMLElement;
  loadingLabel: HTMLElement;
  loadingBar: HTMLElement;
  dropzone: HTMLElement;
  toast: HTMLElement;
  fileInput: HTMLInputElement;
  mob: HTMLElement;
  mobSheet: HTMLElement;
  mobCopy: HTMLButtonElement;
  mobOpen: HTMLButtonElement;
}

export interface AppOptions {
  /** Chrome-less mode for iframes: the render alone, no panels, storage or drag and drop. */
  embed: boolean;
  /** Orbit controls on/off (embeds can turn them off for background use). */
  orbit: boolean;
  /** Persist settings to localStorage. */
  persist: boolean;
  /** Load by URL and share links that point back at this site (not possible inside the Artifact sandbox). */
  networkFeatures: boolean;
  /** The page's markup as it was before the app filled it in; embed downloads are built from it. */
  shell: string;
}

/** The first model: a `?model=` value (a URL or `sample:id`), or the one an embed page carries. */
export type StartModel = string | EmbedModel | null;

interface LoadTask {
  loaded: LoadedModel;
  source: ModelSource;
  update?: (time: number) => void;
}

const LOOK_KEYS_CHANGING_ATLAS: SettingKey[] = ['charset', 'customChars', 'font', 'bold', 'glyphScale'];
const REVEAL_SECONDS = 1.2;
/** A frame smaller than this between the panels isn't worth framing into; the whole stage is used instead. */
const MIN_FRAME = { w: 220, h: 160 };
/** Past this, a ground counts as light (dark ink reads better on it than white does). */
const LIGHT_GROUND = 0.179;

export class App {
  readonly store: SettingsStore;
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly asciiPass: AsciiPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly stage: Stage;
  private readonly loader: ModelLoader;
  private readonly toaster: Toaster;
  private readonly tour = new Tour();
  private readonly timer = new Timer();
  private readonly pointer: PointerState = { x: 0, y: 0, active: false };
  private readonly lens = { x: -1e4, y: -1e4, inside: false, cellX: -1, cellY: -1 };
  private panel: Panel | null = null;
  private theme: UiTheme;
  private current: LoadedModel | null = null;
  private startClip = -1;

  private pixelRatio = 1;
  private cssWidth = 1;
  private cssHeight = 1;
  /** The part of the canvas that exports capture and the model is framed in (CSS px). */
  private frameRect: FrameRect = { x: 0, y: 0, w: 1, h: 1 };
  private layoutQueued = 0;
  private elapsed = 0;
  private scanPhase = 0;
  private revealStart = -1;
  private lensStrength = 0;
  private loadToken = 0;
  private loadingTimer = 0;
  private atlasToken = 0;
  private recorder: CanvasRecorder | null = null;
  private recordTarget: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  private embedBusy = false;
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
    this.toaster = new Toaster(dom.toast);
    this.theme = document.documentElement.dataset.ui === 'dark' ? 'dark' : 'light';

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

  /** Builds the interface, starts rendering and loads the first model. */
  async start(model: StartModel, clip = -1): Promise<void> {
    const { dom, options } = this;
    dom.app.classList.toggle('embed', options.embed);
    dom.fileInput.accept = ACCEPTED_FILES;
    this.startClip = clip;

    if (!options.embed) {
      paintIcons(document);
      this.panel = new Panel(dom.railLeft, dom.railRight, this.store, this.panelActions(), { network: options.networkFeatures }, this.theme);
      this.bindChrome();
      this.bindThemeSwitch();
      this.bindDragAndDrop();
      this.bindKeyboard();
      this.bindPhone();
      wireSound(dom.soundButton);
    }
    this.bindPointer();

    this.stage.shadingLibrary.updateMaterials(this.store.value);
    this.stage.setFov(this.store.value.fov);
    this.applyLook();
    this.store.subscribe((changed, s) => this.onSettingsChange(changed, s));

    const observer = new ResizeObserver(() => this.scheduleLayout());
    for (const el of [dom.stage, dom.cta, dom.stagebar, dom.railLeft, dom.railRight]) observer.observe(el);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.setMotionPaused(true);
    this.layout();

    dom.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.toast('The graphics context was lost. Reload the page to continue.', 'error');
    });

    this.renderer.setAnimationLoop((time) => this.frame(time));
    await this.loadInitialModel(model);
    if (!options.embed) this.tour.maybeStart();
  }

  // ─── Theme & look ────────────────────────────────────────

  /** The settings as rendered: with "Match the interface theme" on, the theme supplies ground and ink. */
  private look(): Settings {
    return effectiveSettings(this.store.value, this.theme);
  }

  private setTheme(theme: UiTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    document.documentElement.dataset.ui = theme;
    writePref('ui', theme);
    this.syncThemeSwitch();
    this.panel?.setTheme(theme);
    this.applyLook();
  }

  private syncThemeSwitch(): void {
    this.dom.themeSwitch.querySelectorAll<HTMLButtonElement>('button[data-v]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.v === this.theme));
    });
  }

  private onSettingsChange(changed: ReadonlySet<SettingKey>, s: Readonly<Settings>): void {
    this.applyLook();
    const cellChanged = (changed.has('cellSize') || changed.has('charAspect')) && this.updateCellSize();
    if (!cellChanged && LOOK_KEYS_CHANGING_ATLAS.some((key) => changed.has(key))) this.refreshAtlas();
    if (changed.has('shading')) this.stage.setShading(s.shading);
    if (changed.has('baseColor') || changed.has('flatShading')) this.stage.shadingLibrary.updateMaterials(s);
    if (changed.has('fov')) this.stage.setFov(s.fov);
    if (changed.has('frame')) this.layout();
    if (this.options.persist) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = window.setTimeout(() => storeSettings(this.store.value), 300);
    }
  }

  private applyLook(): void {
    const look = this.look();
    this.asciiPass.applySettings(look);
    this.bloomPass.enabled = look.glow > 0.001;
    this.bloomPass.strength = look.glow;
    this.bloomPass.radius = look.glowRadius;
    this.bloomPass.threshold = look.glowThreshold;

    const { stage, app } = this.dom;
    const house = THEME_GROUND[this.theme].bg;
    const transparent = look.transparentBg;
    const ground = transparent ? house : look.bg;
    const root = document.documentElement.style;
    root.setProperty('--ground', transparent && this.options.embed ? 'transparent' : ground);
    stage.classList.toggle('transparent', transparent);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground);

    // A ground unlike the interface's own gets floating controls with their own
    // surface, and panels that wash up opaque enough to read over it.
    const own = ground.toLowerCase() !== house;
    const light = relativeLuminance(ground) > LIGHT_GROUND;
    stage.classList.toggle('onart', own);
    stage.classList.toggle('onlight', own && light);
    app.classList.toggle('washup', own && light === (this.theme === 'dark'));
    // Outside a fixed frame, the render fades toward its own ground.
    stage.style.setProperty('--frame-dim', `${ground}9e`);
  }

  // ─── Layout ──────────────────────────────────────────────

  private scheduleLayout(): void {
    if (this.layoutQueued) return;
    this.layoutQueued = requestAnimationFrame(() => {
      this.layoutQueued = 0;
      this.layout();
    });
  }

  private chromeVisible(): boolean {
    return !this.options.embed && !this.dom.app.classList.contains('ui-hidden');
  }

  /** The clear ground between the panels, under the top bar and above the buttons (stage CSS px). */
  private freeArea(width: number, height: number): FrameRect {
    const whole = { x: 0, y: 0, w: width, h: height };
    if (!this.chromeVisible()) return whole;
    const { dom } = this;
    const origin = dom.stage.getBoundingClientRect();
    let left = 0;
    let right = width;
    let top = 0;
    let bottom = height;
    // The rails float over the stage only on wide screens; below that they sit beside or under it.
    if (getComputedStyle(dom.railLeft).position === 'absolute') {
      const l = dom.railLeft.getBoundingClientRect();
      const r = dom.railRight.getBoundingClientRect();
      if (l.width) left = Math.max(left, l.right - origin.left);
      if (r.width) right = Math.min(right, r.left - origin.left);
    }
    const bar = dom.stagebar.getBoundingClientRect();
    if (bar.height) top = Math.max(top, bar.bottom - origin.top);
    const cta = dom.cta.getBoundingClientRect();
    if (cta.height) bottom = Math.min(bottom, cta.top - origin.top - 8);
    const area = { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) };
    return area.w >= MIN_FRAME.w && area.h >= MIN_FRAME.h ? area : whole;
  }

  /** The export frame: the free area itself, or the largest rectangle of the chosen shape inside it. */
  private fitFrame(free: FrameRect): FrameRect {
    const frame = this.store.value.frame;
    if (frame === 'fill') return free;
    const [a, b] = frame.split(':').map(Number);
    const ratio = a / b;
    const inset = this.chromeVisible() ? 16 : 0;
    let w = Math.max(1, free.w - inset * 2);
    let h = Math.max(1, free.h - inset * 2);
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    w = Math.floor(w);
    h = Math.floor(h);
    return { x: Math.round(free.x + (free.w - w) / 2), y: Math.round(free.y + (free.h - h) / 2), w, h };
  }

  private layout(): void {
    const { stage } = this.dom;
    this.cssWidth = Math.max(1, Math.floor(stage.clientWidth));
    this.cssHeight = Math.max(1, Math.floor(stage.clientHeight));
    const free = this.freeArea(this.cssWidth, this.cssHeight);
    this.frameRect = this.fitFrame(free);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.applySize(this.cssWidth, this.cssHeight, this.frameRect, this.pixelRatio);

    // Overlays centre on the free area rather than the window.
    const origin = stage.getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty('--free-cx', `${free.x + free.w / 2}px`);
    root.setProperty('--free-vx', `${origin.left + free.x + free.w / 2}px`);

    const marks = this.dom.framemarks;
    const fixed = this.store.value.frame !== 'fill' && !this.options.embed;
    marks.hidden = !fixed;
    if (fixed) {
      const f = this.frameRect;
      marks.style.left = `${f.x}px`;
      marks.style.top = `${f.y}px`;
      marks.style.width = `${f.w}px`;
      marks.style.height = `${f.h}px`;
    }
  }

  private applySize(width: number, height: number, frame: FrameRect, ratio: number): void {
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.stage.setFrame(width, height, frame);
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
    this.asciiPass.applySettings(this.look());
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
    if (this.recordTarget) this.copyFrameTo(this.recordTarget.ctx, this.recordTarget.canvas);
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

    const f = this.frameRect;
    const cols = Math.round((f.w * this.pixelRatio) / this.asciiPass.cellWidth);
    const rows = Math.round((f.h * this.pixelRatio) / this.asciiPass.cellHeight);
    const info = this.stage.info;
    const clip = this.stage.clipProgress();
    const item = (label: string, value: string) => `${label} <b>${value}</b>`;
    const parts = [
      this.recorder ? '<b>● Rec</b>' : this.stage.motionPaused ? 'Paused' : 'Live',
      item('Cells', `${cols}×${rows}`),
      item('FPS', String(this.fps)),
    ];
    if (info) parts.push(item('Tris', formatCount(info.triangles)));
    if (clip) parts.push(item(escapeHtml(clip.name), `${clip.time.toFixed(1)}/${clip.duration.toFixed(1)}<i>s</i>`));
    if (this.lens.inside && this.lens.cellX >= 0) parts.push(item('Cursor', `${pad3(this.lens.cellX)}·${pad3(this.lens.cellY)}`));
    const html = parts.join(' · ');
    if (this.dom.telemetry.innerHTML !== html) this.dom.telemetry.innerHTML = html;
    if (!this.recorder) this.syncRecordButton();
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
      this.layout();
    }
  }

  // ─── Models ──────────────────────────────────────────────

  private async loadInitialModel(model: StartModel): Promise<void> {
    if (model && typeof model === 'object') {
      const ok = await this.loadEmbedModel(model);
      if (!ok) this.dom.loading.hidden = true;
      return;
    }
    if (model && model.startsWith('sample:') && isSampleId(model.slice(7))) {
      await this.loadSample(model.slice(7) as SampleId);
    } else if (model && this.options.networkFeatures) {
      const ok = await this.loadUrl(model);
      if (!ok) await this.loadSample('fox');
    } else {
      await this.loadSample('fox');
    }
  }

  /** The model inside an embed page: a sample, a file beside the page, or bytes in the page itself. */
  private loadEmbedModel(model: EmbedModel): Promise<boolean> {
    if (model.kind === 'sample') return this.loadSample(isSampleId(model.id) ? model.id : 'fox');
    if (model.kind === 'url') {
      if (location.protocol === 'file:') {
        // Browsers don't let a page opened from disk read the file next to it.
        this.toast(
          'This embed loads model.glb from its web host, so it has to be online to show. Upload the folder (e.g. to vercel.com/drop), or use the single .html download to open it from your computer.',
          'error',
          60_000,
        );
        return Promise.resolve(false);
      }
      const url = new URL(model.url, location.href).href;
      return this.loadModel(model.name, async () => ({
        loaded: await this.loader.fromUrl(url, (p) => this.showProgress(p), model.name),
        source: { kind: 'url', url },
      }));
    }
    return this.loadModel(model.name, async () => ({
      loaded: await this.loader.fromBuffer(base64ToBytes(model.base64).buffer, model.name),
      source: { kind: 'file' },
    }));
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
      const { loaded } = result;
      const info = this.stage.setModel(loaded.object, loaded.clips, loaded.name, result.source, result.update);
      this.current = loaded;
      this.stage.setShading(s.shading);
      this.stage.shadingLibrary.updateMaterials(s);
      if (this.startClip >= 0 && this.startClip < info.clips.length) this.stage.playClip(this.startClip, 0);
      this.startClip = -1;
      this.panel?.setModel(info, this.stage.activeClip, result.source.kind !== 'file' && this.options.networkFeatures);
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
    this.dom.hideButton.setAttribute('aria-label', hidden ? 'Show the panels' : 'Hide the panels');
    this.dom.hideButton.title = hidden ? 'Show the panels (H)' : 'Hide the panels (H)';
    this.layout();
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      this.toast("Full screen isn't available here.", 'error');
    }
  }

  // ─── Exports ─────────────────────────────────────────────

  /** The name in the Download panel, made safe for a file system. */
  private exportBase(): string {
    const typed = (this.panel?.fileName ?? '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
      .replace(/^[.\s-]+|[.\s]+$/g, '');
    return typed || `ascii3d-${slug(this.stage.info?.name ?? 'model')}`;
  }

  /**
   * Renders the frame alone, as its own canvas at `ratio`, runs `read` while
   * those pixels are current, then puts the live view back. Nothing is
   * painted in between, so the screen never shows the intermediate size.
   */
  private renderFrame<T>(ratio: number, read: () => T): T {
    const f = this.frameRect;
    const u = this.asciiPass.uniforms;
    const lens = u.uLens.value as number;
    this.exporting = true;
    try {
      u.uLens.value = 0;
      this.applySize(f.w, f.h, { x: 0, y: 0, w: f.w, h: f.h }, ratio);
      this.composer.render(0);
      return read();
    } finally {
      u.uLens.value = lens;
      this.applySize(this.cssWidth, this.cssHeight, this.frameRect, this.pixelRatio);
      this.composer.render(0);
      this.exporting = false;
    }
  }

  private copyCanvas(): HTMLCanvasElement {
    const source = this.dom.canvas;
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext('2d')?.drawImage(source, 0, 0);
    return copy;
  }

  /** Copies the frame's pixels out of the live canvas (call right after rendering). */
  private copyFrameTo(ctx: CanvasRenderingContext2D, target: HTMLCanvasElement): void {
    const f = this.frameRect;
    const r = this.pixelRatio;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(this.dom.canvas, f.x * r, f.y * r, f.w * r, f.h * r, 0, 0, target.width, target.height);
  }

  async savePng(): Promise<void> {
    if (this.recorder) {
      // A high-resolution still resizes the renderer, which would show in the video.
      this.toast('Stop the recording before saving an image.', 'error');
      return;
    }
    // N× the on-screen resolution, capped by what the GPU can render in one pass.
    const gl = this.renderer.getContext();
    const maxSide = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const f = this.frameRect;
    const ratio = Math.min(this.pixelRatio * (this.panel?.pngScale ?? 1), maxSide / Math.max(f.w, f.h));
    try {
      const still = this.renderFrame(ratio, () => this.copyCanvas());
      const blob = await new Promise<Blob | null>((resolve) => still.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser could not encode the image.');
      const outcome = await saveFile(`${this.exportBase()}.png`, blob);
      if (outcome === 'saved') this.toast(`PNG saved, ${still.width}×${still.height}.`);
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

  private videoSeconds(): number {
    const length = this.panel?.videoLength ?? 'loop';
    return length === 'loop' ? this.loopSeconds() : length;
  }

  private syncRecordButton(): void {
    const length = this.panel?.videoLength ?? 'loop';
    const sub = length === 'loop' ? 'One full turn, saved as video' : `${length} seconds, saved as video`;
    if (this.dom.recordSub.textContent !== sub) this.dom.recordSub.textContent = sub;
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
    const seconds = this.videoSeconds();
    // The frame is copied into its own canvas every frame; video encoders want even sizes.
    const f = this.frameRect;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(f.w * this.pixelRatio) & ~1);
    canvas.height = Math.max(2, Math.round(f.h * this.pixelRatio) & ~1);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.toast('Canvas 2D is unavailable, so the video could not be recorded.', 'error');
      return;
    }
    let recorder: CanvasRecorder;
    try {
      recorder = new CanvasRecorder(canvas, seconds, format);
    } catch (error) {
      this.toast(errorMessage(error), 'error');
      return;
    }
    this.recorder = recorder;
    this.recordTarget = { canvas, ctx };
    const { recordButton, recordTitle, recordSub } = this.dom;
    recordButton.classList.add('recording');
    recordTitle.textContent = 'Stop recording';
    const update = () => {
      const label = `${formatSeconds(recorder.elapsed)} / ${formatSeconds(seconds)}`;
      recordSub.textContent = label;
      this.panel?.setRecording(true, `Stop · ${label}`);
    };
    update();
    const timer = window.setInterval(update, 200);

    recorder.finished
      .then((blob) => saveFile(`${this.exportBase()}.${recorder.extension}`, blob))
      .then((outcome) => outcome === 'saved' && this.toast(`Video saved (${recorder.extension.toUpperCase()}).`))
      .catch((error) => this.toast(errorMessage(error), 'error'))
      .finally(() => {
        window.clearInterval(timer);
        this.recorder = null;
        this.recordTarget = null;
        recordButton.classList.remove('recording');
        recordTitle.textContent = 'Record a loop';
        this.syncRecordButton();
        this.panel?.setRecording(false);
      });
  }

  private asciiGrid(): AsciiCell[][] {
    const look = this.look();
    const data = this.asciiPass.readCells(this.renderer);
    return cellsToAscii(data, this.asciiPass.cols, this.asciiPass.rows, rampFor(look), {
      ...look,
      cellAspect: this.asciiPass.cellWidth / this.asciiPass.cellHeight,
    });
  }

  /** The characters inside the frame, from a render of the frame alone. */
  private frameGrid(): AsciiCell[][] {
    return this.renderFrame(this.pixelRatio, () => this.asciiGrid());
  }

  async copyAscii(): Promise<void> {
    const text = asciiToText(this.frameGrid());
    if (!text) return this.toast('The frame is empty; there is nothing to copy.', 'error');
    const ok = await copyText(text);
    this.toast(ok ? `Copied ${text.split('\n').length} lines of ASCII.` : 'Copy was blocked. Export as text instead.', ok ? 'info' : 'error');
  }

  async saveAscii(): Promise<void> {
    const text = asciiToText(this.frameGrid());
    if (!text) return this.toast('The frame is empty; there is nothing to save.', 'error');
    await this.trySave(`${this.exportBase()}.txt`, text, 'Text saved.');
  }

  async saveSvg(): Promise<void> {
    const look = this.look();
    const ratio = this.pixelRatio;
    const cellWidth = this.asciiPass.cellWidth / ratio;
    const cellHeight = this.asciiPass.cellHeight / ratio;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return this.toast('Canvas 2D is unavailable, so the SVG could not be built.', 'error');
    const family = FONTS[look.font].family;
    const svgText = buildSvg({
      grid: this.frameGrid(),
      cellWidth,
      cellHeight,
      metrics: measureGlyphMetrics(ctx, family, look.bold, cellWidth, cellHeight, look.glyphScale),
      fontStack: fontStack(family),
      bold: look.bold,
      background: look.transparentBg ? null : look.bg,
      colorOf: glyphColorFn(look),
    });
    await this.trySave(`${this.exportBase()}.svg`, svgText, 'SVG saved.');
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
    await this.trySave(`${this.exportBase()}-look.json`, body, 'Look saved.');
  }

  private runExport(): void {
    switch (this.panel?.format ?? 'png') {
      case 'png':
        void this.savePng();
        break;
      case 'video':
        this.toggleRecording();
        break;
      case 'svg':
        void this.saveSvg();
        break;
      case 'txt':
        void this.saveAscii();
        break;
      case 'json':
        void this.saveLook();
        break;
    }
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
      this.toast(`Applied the look from ${file.name}.`);
    } catch {
      this.toast(`${file.name} isn't a look file saved from this tool.`, 'error');
    }
  }

  // ─── Sharing & embeds ────────────────────────────────────

  /**
   * A link back to this site with the model and the look in it. An embed link
   * carries the look as rendered, so it no longer follows anyone's theme.
   */
  private shareUrl(embed: boolean): URL {
    const url = new URL(location.pathname, location.origin);
    const source = this.stage.info?.source;
    if (source?.kind === 'sample') url.searchParams.set('model', `sample:${source.id}`);
    if (source?.kind === 'url') url.searchParams.set('model', source.url);
    if (embed) {
      url.searchParams.set('embed', '1');
      if (this.panel && !this.panel.embedOrbit) url.searchParams.set('controls', '0');
      if (this.stage.activeClip > 0) url.searchParams.set('clip', String(this.stage.activeClip));
    }
    const encoded = encodeSettings(diffFromDefaults(embed ? this.look() : this.store.value));
    if (encoded !== encodeSettings({})) url.hash = `s=${encoded}`;
    return url;
  }

  private embedTitle(): string {
    return `${this.stage.info?.name ?? 'Model'} in ASCII`;
  }

  private async copyShareLink(): Promise<void> {
    const ok = await copyText(this.shareUrl(false).href);
    this.toast(ok ? 'Link copied. It opens this model with this look.' : 'Copy was blocked by the browser.', ok ? 'info' : 'error');
  }

  /** For a model that is already online (a sample or a public link): the code works as it is. */
  private async copyEmbedCode(): Promise<void> {
    const code = iframeCode(this.shareUrl(true).href, this.panel?.embedShape ?? '16/9', this.embedTitle());
    this.panel?.showEmbedCode(code);
    const ok = await copyText(code);
    this.toast(ok ? 'Embed code copied. Paste it into your page’s HTML.' : 'Copy was blocked; select the code below and copy it.', ok ? 'info' : 'error');
  }

  /** Step 3 of the private embed: the link to the page the person put online. */
  private async copyHostedEmbed(raw: string): Promise<void> {
    if (!raw) {
      this.toast('Paste the link to your hosted embed first, like https://my-embed.vercel.app', 'error');
      return;
    }
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      this.toast("That doesn't look like a link. It should start with https://", 'error');
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      this.toast('The link should start with https://', 'error');
      return;
    }
    const code = iframeCode(url.href, this.panel?.embedShape ?? '16/9', this.embedTitle());
    this.panel?.showEmbedCode(code);
    const ok = await copyText(code);
    this.toast(ok ? 'Embed code copied. Paste it into your page’s HTML.' : 'Copy was blocked; select the code below and copy it.', ok ? 'info' : 'error');
  }

  /**
   * The model for an embed page: the file exactly as loaded when it can travel
   * alone, otherwise a fresh .glb written from what is on screen. The
   * procedural samples are rebuilt from their name.
   */
  private async embedModel(): Promise<{ sample: SampleId } | { bytes: Uint8Array<ArrayBuffer> }> {
    const source = this.stage.info?.source;
    if (source?.kind === 'sample' && source.id !== 'fox') return { sample: source.id };
    const glb = this.current?.glb;
    if (glb && glbIsPortable(glb)) return { bytes: new Uint8Array(glb) };
    return { bytes: await this.exportGlb() };
  }

  private async exportGlb(): Promise<Uint8Array<ArrayBuffer>> {
    const current = this.current;
    if (!current) throw new Error('Load a model first.');
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    // Pack the model's own materials; the embed applies the shading itself.
    this.stage.setShading('original');
    try {
      const result = await new GLTFExporter().parseAsync(current.object, {
        binary: true,
        animations: current.clips,
        onlyVisible: true,
      });
      if (!(result instanceof ArrayBuffer)) throw new Error('The model could not be packed for the embed.');
      return new Uint8Array(result);
    } catch (error) {
      throw new Error(`The model could not be packed for the embed: ${errorMessage(error)}`);
    } finally {
      this.stage.setShading(this.store.value.shading);
    }
  }

  /** Step 1 of the private embed: one page with this app, the model and the look inside it. */
  private async downloadEmbed(kind: 'zip' | 'html'): Promise<void> {
    const info = this.stage.info;
    if (!info || this.embedBusy) return;
    if (import.meta.env.DEV) {
      this.toast('Embeds are packed from the built app: run npm run build, then npm run preview, or use the deployed site.', 'error', 8000);
      return;
    }
    this.embedBusy = true;
    this.panel?.setEmbedBusy(kind);
    try {
      const [code, model] = await Promise.all([collectAppCode(), this.embedModel()]);
      const look = this.look();
      const files: ZipEntry[] = [];
      let embedModel: EmbedModel;
      if ('sample' in model) embedModel = { kind: 'sample', id: model.sample };
      else if (kind === 'zip') {
        embedModel = { kind: 'url', url: 'model.glb', name: info.name };
        files.push({ name: 'model.glb', data: model.bytes });
      } else {
        embedModel = { kind: 'data', name: info.name, base64: bytesToBase64(model.bytes) };
      }
      const config: EmbedConfig = {
        settings: diffFromDefaults(look),
        model: embedModel,
        orbit: this.panel?.embedOrbit ?? true,
        clip: this.stage.activeClip >= 0 ? this.stage.activeClip : undefined,
      };
      const page = buildEmbedPage({
        code,
        shell: this.options.shell,
        config,
        title: this.embedTitle(),
        theme: relativeLuminance(look.bg) > LIGHT_GROUND ? 'light' : 'dark',
        ground: look.transparentBg ? 'transparent' : look.bg,
      });
      const base = `${this.exportBase()}-embed`;
      const outcome =
        kind === 'zip'
          ? await saveFile(`${base}.zip`, await buildZip([{ name: 'index.html', data: page }, ...files]))
          : await saveFile(`${base}.html`, page);
      if (outcome === 'saved') {
        this.toast(
          kind === 'zip'
            ? 'Embed saved. Drag the .zip onto vercel.com/drop, then paste the link it gives you in step 3.'
            : 'Embed saved. Upload the .html to any web host, then paste its link in step 3.',
          'info',
          8000,
        );
      }
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    } finally {
      this.embedBusy = false;
      this.panel?.setEmbedBusy(null);
    }
  }

  // ─── Input ───────────────────────────────────────────────

  private panelActions(): PanelActions {
    return {
      openFilePicker: () => this.dom.fileInput.click(),
      loadFiles: (files) => void this.loadFiles(files),
      loadSample: (id) => void this.loadSample(id),
      loadUrl: (url) => void this.loadUrl(url),
      playClip: (index) => this.stage.playClip(index),
      toggleMotion: () => this.setMotionPaused(!this.stage.motionPaused),
      resetView: () => this.stage.resetView(),
      applyPreset: (id) => {
        const preset = PRESETS.find((p) => p.id === id);
        if (preset) this.store.set(presetSettings(preset));
      },
      resetAll: () => this.store.set(defaultSettings()),
      runExport: () => this.runExport(),
      copyText: () => void this.copyAscii(),
      loadLook: () => this.pickLookFile(),
      copyEmbedCode: () => void this.copyEmbedCode(),
      copyShareLink: () => void this.copyShareLink(),
      downloadEmbed: (kind) => void this.downloadEmbed(kind),
      copyHostedEmbed: (url) => void this.copyHostedEmbed(url),
      startTour: () => this.tour.start(),
    };
  }

  private bindChrome(): void {
    const { dom } = this;
    dom.hideButton.replaceChildren(svg('eye'));
    dom.fullscreenButton.replaceChildren(svg('expand'));
    dom.soundButton.replaceChildren(svg('sound'));
    dom.fileInput.addEventListener('change', () => {
      const files = [...(dom.fileInput.files ?? [])];
      dom.fileInput.value = '';
      if (files.length) void this.loadFiles(files);
    });
    dom.hideButton.addEventListener('click', () => this.toggleUi());
    dom.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen());
    dom.randomButton.addEventListener('click', () => this.store.set(randomLook(this.store.value)));
    dom.recordButton.addEventListener('click', () => this.toggleRecording());
    this.syncRecordButton();
  }

  private bindThemeSwitch(): void {
    this.dom.themeSwitch.querySelectorAll<HTMLButtonElement>('button[data-v]').forEach((b) => {
      b.replaceChildren(svg(b.dataset.v === 'dark' ? 'dark' : 'light'));
      b.addEventListener('click', () => this.setTheme(b.dataset.v === 'dark' ? 'dark' : 'light'));
    });
    this.syncThemeSwitch();
  }

  /** On a phone the studio doesn't fit, so a card says what it is and hands over the link. */
  private bindPhone(): void {
    const { mob, mobSheet, mobCopy, mobOpen, app } = this.dom;
    mob.querySelector('.mob-brand')?.insertAdjacentHTML('afterbegin', LOGO_MARK);
    const phone = matchMedia('(max-width: 760px)');
    let stop: (() => void) | null = null;
    const sync = () => {
      const show = phone.matches && !app.classList.contains('mobOpen');
      if (show && !stop) stop = spinTorus(mobSheet, 58, 24);
      else if (!show && stop) {
        stop();
        stop = null;
      }
    };
    phone.addEventListener('change', sync);
    sync();
    mobCopy.addEventListener('click', async () => {
      const ok = await copyText(location.href.split('#')[0]);
      this.toast(ok ? 'Link copied. Open it on a computer for the whole studio.' : 'Copy was blocked by the browser.', ok ? 'info' : 'error');
    });
    mobOpen.addEventListener('click', () => {
      app.classList.add('mobOpen');
      sync();
      window.scrollTo(0, 0);
      this.scheduleLayout();
    });
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
      if (target?.closest('input, select, textarea, [contenteditable="true"], .tour')) return;
      const key = e.key.toLowerCase();
      if (key === ' ') {
        if (target?.closest('button, summary, a, [role="option"]')) return;
        e.preventDefault();
        this.setMotionPaused(!this.stage.motionPaused);
      } else if (key === 'h') this.toggleUi();
      else if (key === 's') void this.savePng();
      else if (key === 'r') this.stage.resetView();
      else if (key === 'f') void this.toggleFullscreen();
      else if (key === 'u' || key === 'o') this.dom.fileInput.click();
      else if (key === 'x') this.store.set(randomLook(this.store.value));
      else if (/^[0-9]$/.test(key)) {
        const preset = PRESETS[key === '0' ? 9 : Number(key) - 1];
        if (preset) this.store.set(presetSettings(preset));
      }
    });
  }

  private bindPointer(): void {
    const { canvas } = this.dom;
    const update = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Follow the cursor relative to the frame, where the model is.
      const f = this.frameRect;
      this.pointer.x = Math.max(-1.5, Math.min(1.5, ((x - f.x) / f.w) * 2 - 1));
      this.pointer.y = Math.max(-1.5, Math.min(1.5, 1 - ((y - f.y) / f.h) * 2));
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
