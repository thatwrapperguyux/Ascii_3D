import { SAMPLES, type SampleId } from '../scene/samples';
import type { ModelInfo } from '../scene/stage';
import { PRESETS, presetSettings } from '../state/presets';
import {
  CHARSETS,
  COLOR_MODES,
  FONTS,
  FRAMES,
  SCAN_DIRECTIONS,
  SETTING_KEYS,
  SHADINGS,
  rampFor,
  type CharsetId,
  type ColorMode,
  type FontId,
  type FrameId,
  type ScanDirection,
  type SettingKey,
  type Settings,
  type Shading,
} from '../state/schema';
import { readPref, writePref } from '../state/share';
import type { SettingsStore } from '../state/store';
import { color, custom, segmented, select, slider, text, toggle, type Control } from './controls';
import { button, formatCount, h, icon } from './dom';

export interface PanelActions {
  applyPreset(id: string): void;
  randomize(): void;
  resetAll(): void;
  loadSample(id: SampleId): void;
  openFilePicker(): void;
  loadUrl(url: string): void;
  playClip(index: number): void;
  toggleMotion(): void;
  resetView(): void;
  savePng(): void;
  toggleRecording(): void;
  copyText(): void;
  saveText(): void;
  saveSvg(): void;
  saveLook(): void;
  loadLook(): void;
  copyShareLink(): void;
  copyEmbedCode(): void;
}

export interface PanelFeatures {
  urlLoading: boolean;
  sharing: boolean;
}

export type PngScale = 1 | 2 | 4;
export type VideoLength = 'loop' | 5 | 10;

interface SectionDef {
  id: string;
  title: string;
  summary: (s: Readonly<Settings>) => string;
  build: (body: HTMLElement) => void;
}

const DEFAULT_OPEN = ['presets', 'model', 'glyphs'];
/** Motion and framing don't count against "this preset is active". */
const PRESET_IGNORED: SettingKey[] = ['spin', 'float', 'follow', 'fov', 'frame', 'animSpeed'];

const entries = <T extends string>(labels: Record<T, string>) => Object.entries(labels) as [T, string][];

export class Panel {
  private readonly controls: Control[] = [];
  private readonly summaries: { el: HTMLElement; fn: (s: Readonly<Settings>) => string }[] = [];
  private readonly openSections: Set<string>;
  private presetButtons: HTMLButtonElement[] = [];
  private sampleButtons: HTMLButtonElement[] = [];
  private statsEl!: HTMLElement;
  private animBlock!: HTMLElement;
  private clipSelect!: HTMLSelectElement;
  private motionButton!: HTMLButtonElement;
  private recordButton!: HTMLButtonElement;
  private model: ModelInfo | null = null;
  pngScale: PngScale = 1;
  videoLength: VideoLength = 'loop';

  constructor(
    private readonly root: HTMLElement,
    private readonly store: SettingsStore,
    private readonly actions: PanelActions,
    private readonly features: PanelFeatures,
  ) {
    let open: string[] = DEFAULT_OPEN;
    try {
      const saved = JSON.parse(readPref('sections') ?? 'null');
      if (Array.isArray(saved)) open = saved.filter((v): v is string => typeof v === 'string');
    } catch {
      // Use defaults.
    }
    this.openSections = new Set(open);
    const png = Number(readPref('pngScale'));
    if (png === 1 || png === 2 || png === 4) this.pngScale = png;
    const video = readPref('videoLength');
    if (video === 'loop' || video === '5' || video === '10') this.videoLength = video === 'loop' ? 'loop' : (Number(video) as 5 | 10);

    this.render();
    store.subscribe((_, s) => this.sync(s));
    this.sync(store.value);
  }

  private render(): void {
    this.root.replaceChildren(h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }));
    for (const section of this.sections()) this.root.append(this.renderSection(section));
  }

  private renderSection(def: SectionDef): HTMLElement {
    const bodyId = `sec-${def.id}`;
    const open = this.openSections.has(def.id);
    const meta = h('span', { class: 'section-meta' });
    const head = h(
      'button',
      { type: 'button', class: 'section-head', 'aria-expanded': String(open), 'aria-controls': bodyId },
      h('span', { class: 'section-title' }, def.title),
      meta,
      icon('chevron'),
    );
    const body = h('div', { class: 'section-body', id: bodyId });
    body.hidden = !open;
    def.build(body);
    head.addEventListener('click', () => {
      const next = body.hidden;
      body.hidden = !next;
      head.setAttribute('aria-expanded', String(next));
      if (next) this.openSections.add(def.id);
      else this.openSections.delete(def.id);
      writePref('sections', JSON.stringify([...this.openSections]));
    });
    this.summaries.push({ el: meta, fn: def.summary });
    return h('section', { class: 'section', 'data-section': def.id }, head, body);
  }

  private add(body: HTMLElement, ...controls: Control[]): void {
    for (const control of controls) {
      this.controls.push(control);
      body.append(control.el);
    }
  }

  private sections(): SectionDef[] {
    const { store } = this;
    return [
      {
        id: 'presets',
        title: 'Looks',
        summary: () => this.activePresetName() ?? 'Custom',
        build: (body) => {
          this.presetButtons = PRESETS.map((preset, i) => {
            const look = presetSettings(preset);
            const glyphColor = look.colorMode === 'mono' ? look.fg : look.colorMode === 'gradient' ? look.gradC : '#ffffff';
            const swatch = h(
              'span',
              { class: 'preset-swatch', 'aria-hidden': 'true' },
              h('span', { style: `background:${look.bg};color:${glyphColor}` }, rampFor(look).slice(1, 5).join('')),
              h('span', { style: `background:${look.colorMode === 'gradient' ? look.gradB : glyphColor}` }),
              h('span', { style: `background:${look.accent}` }),
            );
            const btn = h(
              'button',
              { type: 'button', class: 'preset', 'aria-pressed': 'false', title: `${preset.hint} (${i + 1})` },
              swatch,
              h('span', { class: 'preset-name' }, preset.name),
            );
            btn.addEventListener('click', () => this.actions.applyPreset(preset.id));
            return btn;
          });
          const randomize = button('Randomize', { title: 'Random look (X)' }, 'dice');
          randomize.addEventListener('click', () => this.actions.randomize());
          const reset = button('Reset all', { title: 'Restore every setting to its default' }, 'undo');
          reset.addEventListener('click', () => this.actions.resetAll());
          body.append(h('div', { class: 'presets' }, ...this.presetButtons), h('div', { class: 'button-row' }, randomize, reset));
        },
      },
      {
        id: 'model',
        title: 'Model',
        summary: () => (this.model ? `${this.model.name} · ${formatCount(this.model.triangles)} tris` : 'None'),
        build: (body) => {
          const upload = button('Upload model', { class: 'btn btn-primary btn-block' }, 'upload');
          upload.addEventListener('click', () => this.actions.openFilePicker());
          this.sampleButtons = SAMPLES.map((sample) => {
            const btn = h('button', { type: 'button', class: 'sample', title: sample.hint, 'aria-pressed': 'false', 'data-id': sample.id }, sample.label);
            btn.addEventListener('click', () => this.actions.loadSample(sample.id));
            return btn;
          });
          body.append(
            upload,
            h('p', { class: 'help' }, 'Or drop a .glb, .gltf, .fbx, .obj or .stl file anywhere. Files stay on your device.'),
            h('p', { class: 'subhead' }, 'Samples'),
            h('div', { class: 'samples' }, ...this.sampleButtons),
          );

          if (this.features.urlLoading) {
            const url = h('input', {
              type: 'url',
              id: 'model-url',
              class: 'text-input',
              placeholder: 'https://example.com/model.glb',
              'aria-label': 'Model URL',
              spellcheck: 'false',
            });
            const load = button('Load', {}, 'download');
            const go = () => url.value.trim() && this.actions.loadUrl(url.value.trim());
            load.addEventListener('click', go);
            url.addEventListener('keydown', (e) => e.key === 'Enter' && go());
            body.append(h('p', { class: 'subhead' }, 'From a URL'), h('div', { class: 'url-row' }, url, load));
          }

          this.statsEl = h('dl', { class: 'stats' });
          body.append(this.statsEl);

          this.add(
            body,
            segmented(store, 'shading', 'Shading', entries<Shading>(SHADINGS), {
              grid: true,
              hint: 'How the model is lit before it becomes glyphs.',
            }),
            color(store, 'baseColor', 'Surface color', {
              when: (s) => s.shading === 'clay' || s.shading === 'toon' || s.shading === 'wireframe',
            }),
            toggle(store, 'flatShading', 'Faceted', {
              hint: 'Flat shading per triangle.',
              when: (s) => s.shading === 'clay' || s.shading === 'normal',
            }),
          );

          this.clipSelect = h('select', { id: 'clip-select', 'aria-label': 'Animation clip' });
          this.clipSelect.addEventListener('change', () => this.actions.playClip(Number(this.clipSelect.value)));
          this.motionButton = button('Pause', { title: 'Pause or play all motion (Space)' }, 'pause');
          this.motionButton.addEventListener('click', () => this.actions.toggleMotion());
          const speed = slider(store, 'animSpeed', 'Animation speed', { unit: '×' });
          this.controls.push(speed);
          this.animBlock = h(
            'div',
            { class: 'section-body', style: 'padding:0' },
            h('p', { class: 'subhead' }, 'Animation'),
            h('div', { class: 'anim-row' }, this.clipSelect, this.motionButton),
            speed.el,
          );
          this.animBlock.hidden = true;
          body.append(this.animBlock);
        },
      },
      {
        id: 'glyphs',
        title: 'Glyphs',
        summary: (s) => `${CHARSETS[s.charset].label.replace('…', '')} · ${s.cellSize}px`,
        build: (body) => {
          const preview = h('pre', { class: 'ramp-preview', 'aria-label': 'Character ramp, light to dense' });
          this.add(
            body,
            select(store, 'charset', 'Character set', (Object.keys(CHARSETS) as CharsetId[]).map((id) => [id, CHARSETS[id].label])),
            text(store, 'customChars', 'Custom characters', {
              placeholder: ' .:-=+*#%@',
              hint: 'Order from lightest to densest. Start with a space so dark areas stay empty.',
              when: (s) => s.charset === 'custom',
            }),
            custom(preview, (s) => {
              const ramp = rampFor(s).map((c) => (c === ' ' ? '·' : c)).join('');
              if (preview.textContent !== ramp) preview.textContent = ramp;
              preview.style.fontFamily = FONTS[s.font].family ? `"${FONTS[s.font].family}", monospace` : 'monospace';
            }),
            slider(store, 'cellSize', 'Cell size', { unit: 'px', hint: 'Height of one character cell.' }),
            slider(store, 'charAspect', 'Character width', { hint: 'Cell width as a fraction of its height.' }),
            slider(store, 'glyphScale', 'Glyph scale', { scale: 100, unit: '%', hint: 'Size of each glyph inside its cell.' }),
            select(store, 'font', 'Font', (Object.keys(FONTS) as FontId[]).map((id) => [id, FONTS[id].label])),
            toggle(store, 'bold', 'Bold'),
          );
        },
      },
      {
        id: 'tone',
        title: 'Tone',
        summary: (s) =>
          [`C ${s.contrast.toFixed(2)}`, `γ ${s.gamma.toFixed(2)}`, s.invert && 'inverted', s.edges && 'edges']
            .filter(Boolean)
            .join(' · '),
        build: (body) => {
          this.add(
            body,
            slider(store, 'exposure', 'Exposure', { hint: 'Scene brightness before glyph mapping.' }),
            slider(store, 'brightness', 'Brightness'),
            slider(store, 'contrast', 'Contrast'),
            slider(store, 'gamma', 'Gamma', { hint: 'Above 1 opens up the midtones.' }),
            slider(store, 'threshold', 'Cutoff', { hint: 'Cells darker than this stay empty.' }),
            slider(store, 'dither', 'Dither', { hint: 'Ordered dithering between neighboring glyph levels.' }),
            toggle(store, 'invert', 'Invert', { hint: 'Dense glyphs for dark areas. Use with light backgrounds.' }),
            toggle(store, 'fillSilhouette', 'Fill silhouette', { hint: 'Never leave a covered cell blank.' }),
            toggle(store, 'edges', 'Edge lines', { hint: 'Outline shapes with | / - \\ glyphs.' }),
            slider(store, 'edgeThreshold', 'Edge sensitivity', {
              hint: 'Lower values find more edges.',
              when: (s) => s.edges,
            }),
          );
        },
      },
      {
        id: 'color',
        title: 'Color',
        summary: (s) => `${COLOR_MODES[s.colorMode]} · ${s.transparentBg ? 'transparent' : s.bg}`,
        build: (body) => {
          const gradient = h('div', { class: 'gradient-preview', 'aria-hidden': 'true' });
          this.add(
            body,
            segmented(store, 'colorMode', 'Glyph color', entries<ColorMode>(COLOR_MODES), {
              hint: 'Model: colors from the render. Solid: one color. Gradient: dark → mid → light by brightness.',
            }),
            color(store, 'fg', 'Glyphs', { when: (s) => s.colorMode === 'mono' }),
            color(store, 'gradA', 'Shadows', { when: (s) => s.colorMode === 'gradient' }),
            color(store, 'gradB', 'Midtones', { when: (s) => s.colorMode === 'gradient' }),
            color(store, 'gradC', 'Highlights', { when: (s) => s.colorMode === 'gradient' }),
            custom(
              gradient,
              (s) => (gradient.style.background = `linear-gradient(to right, ${s.gradA}, ${s.gradB}, ${s.gradC})`),
              (s) => s.colorMode === 'gradient',
            ),
            slider(store, 'colorBoost', 'Color boost', {
              hint: 'Lifts dark colors toward full brightness.',
              when: (s) => s.colorMode === 'original',
            }),
            slider(store, 'saturation', 'Saturation', { when: (s) => s.colorMode === 'original' }),
            color(store, 'bg', 'Background', { when: (s) => !s.transparentBg }),
            toggle(store, 'transparentBg', 'Transparent background', { hint: 'For PNG cut-outs and overlays.' }),
            color(store, 'accent', 'Accent', { hint: 'Scan beam, cursor lens, field and grid.' }),
          );
        },
      },
      {
        id: 'light',
        title: 'Light',
        summary: (s) => `${s.lightAzimuth}° · ${s.lightElevation}°`,
        build: (body) => {
          this.add(
            body,
            slider(store, 'lightAzimuth', 'Key direction', { unit: '°', hint: 'Left (−) to right (+), relative to the view.' }),
            slider(store, 'lightElevation', 'Key height', { unit: '°' }),
            slider(store, 'lightIntensity', 'Key strength'),
            slider(store, 'rim', 'Rim light', { hint: 'Back light that outlines the silhouette.' }),
            slider(store, 'ambient', 'Ambient'),
            slider(store, 'envIntensity', 'Reflections', { hint: 'Soft studio environment for glossy materials.' }),
          );
        },
      },
      {
        id: 'motion',
        title: 'Motion',
        summary: (s) => `${s.spin === 0 ? 'still' : `${s.spin}°/s`} · ${FRAMES[s.frame].split(' ')[0]}`,
        build: (body) => {
          const reset = button('Reset view', { title: 'Reset camera (R)' }, 'target');
          reset.addEventListener('click', () => this.actions.resetView());
          this.add(
            body,
            slider(store, 'spin', 'Turntable', { unit: '°/s', hint: 'Negative values spin the other way.' }),
            slider(store, 'float', 'Float', { hint: 'Gentle bobbing.' }),
            slider(store, 'follow', 'Follow cursor', { hint: 'The model turns toward the pointer.' }),
            slider(store, 'fov', 'Field of view', { unit: '°' }),
            select(store, 'frame', 'Frame', entries<FrameId>(FRAMES), { hint: 'Aspect ratio for the view and exports.' }),
          );
          body.append(reset);
        },
      },
      {
        id: 'effects',
        title: 'Effects',
        summary: (s) =>
          [s.scan && 'scan', s.lens && 'lens', s.glow > 0 && 'glow', s.noise > 0 && 'noise', s.crt > 0 && 'crt']
            .filter(Boolean)
            .join(' · ') || 'none',
        build: (body) => {
          this.add(
            body,
            toggle(store, 'scan', 'Scan beam', { hint: 'A sweeping sensor line that scrambles and tints glyphs.' }),
            select(store, 'scanDirection', 'Direction', entries<ScanDirection>(SCAN_DIRECTIONS), { when: (s) => s.scan }),
            slider(store, 'scanSpeed', 'Sweeps per second', { when: (s) => s.scan }),
            slider(store, 'scanWidth', 'Trail length', { when: (s) => s.scan }),
            slider(store, 'scanGlitch', 'Scramble', { when: (s) => s.scan }),
            toggle(store, 'lens', 'Cursor lens', { hint: 'Glyphs near the pointer decode and light up.' }),
            slider(store, 'lensRadius', 'Lens size', { unit: 'px', when: (s) => s.lens }),
            slider(store, 'glow', 'Glow'),
            slider(store, 'glowRadius', 'Glow spread', { when: (s) => s.glow > 0 }),
            slider(store, 'glowThreshold', 'Glow threshold', { when: (s) => s.glow > 0 }),
            slider(store, 'noise', 'Flicker', { hint: 'Random glyph swaps.' }),
            slider(store, 'field', 'Background field', { hint: 'Sparse glyphs in the empty space.' }),
            slider(store, 'grid', 'Cell grid'),
            slider(store, 'crt', 'CRT lines'),
            slider(store, 'vignette', 'Vignette'),
            toggle(store, 'reveal', 'Decode on load', { hint: 'New models resolve through scrambled glyphs.' }),
          );
        },
      },
      {
        id: 'export',
        title: 'Export',
        summary: () => 'PNG · video · text · SVG',
        build: (body) => this.buildExport(body),
      },
      {
        id: 'help',
        title: 'Shortcuts & credits',
        summary: () => '',
        build: (body) => {
          const keys: [string, string][] = [
            ['U', 'Upload a model'],
            ['S', 'Save PNG'],
            ['Space', 'Pause or play motion'],
            ['R', 'Reset view'],
            ['H', 'Hide or show the interface'],
            ['F', 'Full screen'],
            ['X', 'Random look'],
            ['1–9', 'Apply a look'],
          ];
          body.append(
            h('dl', { class: 'keys' }, ...keys.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', { style: 'margin:0' }, v)])),
            h('p', { class: 'help' }, 'Double-click any slider label to reset it.'),
            h(
              'p',
              { class: 'credits' },
              'Fox sample: model by PixelMannen (CC0); rigging and animation by tomkranis (CC BY 4.0); glTF conversion by AsoboStudio and scurest (CC BY 4.0), via the ',
              h('a', { href: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox', target: '_blank', rel: 'noopener' }, 'Khronos glTF sample assets'),
              '. Rendering by ',
              h('a', { href: 'https://threejs.org', target: '_blank', rel: 'noopener' }, 'three.js'),
              '.',
            ),
          );
        },
      },
    ];
  }

  private buildExport(body: HTMLElement): void {
    const pngScale = this.localChoice<PngScale>(
      'png-scale',
      'Resolution',
      [
        [1, '1×'],
        [2, '2×'],
        [4, '4×'],
      ],
      () => this.pngScale,
      (v) => {
        this.pngScale = v;
        writePref('pngScale', String(v));
      },
    );
    const savePng = button('Save PNG', { class: 'btn btn-block' }, 'camera');
    savePng.addEventListener('click', () => this.actions.savePng());

    const videoLength = this.localChoice<VideoLength>(
      'video-length',
      'Length',
      [
        ['loop', 'One loop'],
        [5, '5 s'],
        [10, '10 s'],
      ],
      () => this.videoLength,
      (v) => {
        this.videoLength = v;
        writePref('videoLength', String(v));
      },
    );
    this.recordButton = button('Record video', { class: 'btn btn-block' }, 'record');
    this.recordButton.addEventListener('click', () => this.actions.toggleRecording());

    const copyText = button('Copy', { title: 'Copy the frame as plain text' }, 'copy');
    copyText.addEventListener('click', () => this.actions.copyText());
    const saveTxt = button('.txt', { title: 'Save the frame as a text file' }, 'download');
    saveTxt.addEventListener('click', () => this.actions.saveText());
    const saveSvg = button('.svg', { title: 'Save the frame as vector SVG (editable in Figma or Illustrator)' }, 'download');
    saveSvg.addEventListener('click', () => this.actions.saveSvg());

    const saveLook = button('Save look', { title: 'Save these settings as a .json file' }, 'download');
    saveLook.addEventListener('click', () => this.actions.saveLook());
    const loadLook = button('Load look', { title: 'Load settings from a .json file' }, 'file');
    loadLook.addEventListener('click', () => this.actions.loadLook());

    body.append(
      h('p', { class: 'subhead' }, 'Image'),
      pngScale,
      savePng,
      h('p', { class: 'help' }, 'Turn on Transparent background under Color for a cut-out.'),
      h('p', { class: 'subhead' }, 'Video'),
      videoLength,
      this.recordButton,
      h('p', { class: 'help' }, 'One loop records a full turn of the turntable, so the clip repeats seamlessly.'),
      h('p', { class: 'subhead' }, 'Text & vector'),
      h('div', { class: 'button-row' }, copyText, saveTxt, saveSvg),
      h('p', { class: 'subhead' }, 'Look'),
      h('div', { class: 'button-row' }, saveLook, loadLook),
    );

    if (this.features.sharing) {
      const link = button('Copy link', { title: 'A link that opens this look' }, 'link');
      link.addEventListener('click', () => this.actions.copyShareLink());
      const embed = button('Embed code', { title: 'An <iframe> snippet for your website' }, 'code');
      embed.addEventListener('click', () => this.actions.copyEmbedCode());
      body.append(
        h('p', { class: 'subhead' }, 'Share'),
        h('div', { class: 'button-row' }, link, embed),
        h('p', { class: 'help' }, 'Links carry the settings and the sample or URL model. Uploaded files stay on your device.'),
      );
    }
  }

  /** A segmented control for panel-only preferences (not part of the saved look). */
  private localChoice<T extends string | number>(
    id: string,
    label: string,
    options: [T, string][],
    get: () => T,
    set: (value: T) => void,
  ): HTMLElement {
    const buttons = options.map(([value, text]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(get() === value) }, text),
    );
    const refresh = () => buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i][0] === get())));
    buttons.forEach((b, i) =>
      b.addEventListener('click', () => {
        set(options[i][0]);
        refresh();
      }),
    );
    return h(
      'div',
      { class: 'field' },
      h('span', { class: 'label' }, label),
      h('div', { class: 'segmented', role: 'radiogroup', id: `ctl-${id}`, 'aria-label': label }, ...buttons),
    );
  }

  private activePresetName(): string | null {
    const s = this.store.value;
    const active = PRESETS.find((preset) => {
      const look = presetSettings(preset);
      return SETTING_KEYS.every((key) => PRESET_IGNORED.includes(key) || look[key] === s[key]);
    });
    return active?.name ?? null;
  }

  private sync(s: Readonly<Settings>): void {
    for (const control of this.controls) {
      if (control.when) control.el.hidden = !control.when(s);
      control.sync(s);
    }
    for (const { el, fn } of this.summaries) {
      const value = fn(s);
      if (el.textContent !== value) el.textContent = value;
    }
    const activeName = this.activePresetName();
    this.presetButtons.forEach((btn, i) => btn.setAttribute('aria-pressed', String(PRESETS[i].name === activeName)));
  }

  setModel(info: ModelInfo | null, activeClip: number): void {
    this.model = info;
    const source = info?.source;
    this.sampleButtons.forEach((btn) =>
      btn.setAttribute('aria-pressed', String(source?.kind === 'sample' && source.id === btn.dataset.id)),
    );

    this.statsEl.replaceChildren(
      ...[
        ['Meshes', info ? formatCount(info.meshes) : '–'],
        ['Triangles', info ? formatCount(info.triangles) : '–'],
        ['Clips', info ? String(info.clips.length) : '–'],
      ].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))),
    );

    const clips = info?.clips ?? [];
    this.animBlock.hidden = clips.length === 0;
    this.clipSelect.replaceChildren(...clips.map((name, i) => h('option', { value: i }, name)));
    if (clips.length) this.clipSelect.value = String(Math.max(0, activeClip));
    this.sync(this.store.value);
  }

  setMotionPaused(paused: boolean): void {
    this.motionButton.replaceChildren(icon(paused ? 'play' : 'pause'), h('span', {}, paused ? 'Play' : 'Pause'));
  }

  setRecording(recording: boolean, label?: string): void {
    this.recordButton.replaceChildren(
      icon(recording ? 'stop' : 'record'),
      h('span', {}, recording ? label ?? 'Stop recording' : 'Record video'),
    );
    this.recordButton.classList.toggle('btn-primary', recording);
  }
}
