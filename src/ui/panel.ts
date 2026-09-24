import { ACCEPTED_FILES } from '../scene/loaders';
import { SAMPLES, type SampleId } from '../scene/samples';
import type { ModelInfo } from '../scene/stage';
import { THEME_GROUND, type UiTheme } from '../state/look';
import { PRESETS, PRESET_GROUPS, presetSettings } from '../state/presets';
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
  type FontId,
  type SettingKey,
  type Settings,
} from '../state/schema';
import { readPref, writePref } from '../state/share';
import type { SettingsStore } from '../state/store';
import {
  colorRow,
  custom,
  grp,
  scrub,
  selectRow,
  textField,
  tip,
  toggle,
  type Control,
} from './controls';
import { button, formatCount, h, si, svg } from './dom';
import { Fsel, type FselOption } from './fsel';
import { LOGO_MARK, type IconName } from './icons';

export type ExportFormat = 'png' | 'video' | 'svg' | 'txt' | 'json';
export type PngScale = 1 | 2 | 4;
export type VideoLength = 'loop' | 5 | 10;
export type EmbedShape = '16/9' | '4/3' | '1/1' | '4/5' | '9/16';

export interface PanelActions {
  openFilePicker(): void;
  loadFiles(files: File[]): void;
  loadSample(id: SampleId): void;
  loadUrl(url: string): void;
  playClip(index: number): void;
  toggleMotion(): void;
  resetView(): void;
  applyPreset(id: string): void;
  resetAll(): void;
  runExport(): void;
  copyText(): void;
  loadLook(): void;
  copyEmbedCode(): void;
  copyShareLink(): void;
  downloadEmbed(kind: 'zip' | 'html'): void;
  copyHostedEmbed(url: string): void;
  startTour(): void;
}

export interface PanelFeatures {
  /** Load models by URL and share links (not possible inside the Artifact sandbox). */
  network: boolean;
}

interface SectionDef {
  id: string;
  icon: IconName;
  title: string;
  sub: string;
  open: boolean;
  build: (body: HTMLElement) => void;
}

/** Motion and framing don't count against "this look is active". */
const PRESET_IGNORED: SettingKey[] = ['spin', 'float', 'follow', 'fov', 'frame', 'animSpeed'];

const FORMATS: FselOption[] = [
  { value: 'png', label: 'PNG image' },
  { value: 'video', label: 'Video, MP4 or WebM' },
  { value: 'svg', label: 'SVG with real text' },
  { value: 'txt', label: 'Plain text (.txt)' },
  { value: 'json', label: 'Look settings (.json)' },
];

const SHAPES: FselOption[] = [
  { value: '16/9', label: '16:9 landscape' },
  { value: '4/3', label: '4:3' },
  { value: '1/1', label: '1:1 square' },
  { value: '4/5', label: '4:5 portrait' },
  { value: '9/16', label: '9:16 story' },
];

const entries = (labels: Record<string, string>): FselOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export class Panel {
  private readonly controls: Control[] = [];
  private readonly openSections: Set<string>;
  private publicModel = false;

  // Built in the sections, updated later.
  private lookFsel!: Fsel;
  private modelName!: HTMLElement;
  private sampleChips: HTMLButtonElement[] = [];
  private statsEl!: HTMLElement;
  private animBlock!: HTMLElement;
  private clipFsel!: Fsel;
  private motionBtn!: HTMLButtonElement;
  private exportBtn!: HTMLButtonElement;
  private scaleField!: HTMLElement;
  private lengthField!: HTMLElement;
  private transparentField!: HTMLElement;
  private publicBlock!: HTMLElement;
  private privateBlock!: HTMLElement;
  private codeBox!: HTMLElement;
  private hostedInput!: HTMLInputElement;
  private embedButtons!: Record<'zip' | 'html', HTMLButtonElement>;

  fileName = 'ascii3d';
  format: ExportFormat = 'png';
  pngScale: PngScale = 2;
  videoLength: VideoLength = 'loop';
  embedShape: EmbedShape = '16/9';
  embedOrbit = true;

  constructor(
    private readonly left: HTMLElement,
    private readonly right: HTMLElement,
    private readonly store: SettingsStore,
    private readonly actions: PanelActions,
    private readonly features: PanelFeatures,
    private theme: UiTheme,
  ) {
    let open: string[] | null = null;
    try {
      const saved = JSON.parse(readPref('sections') ?? 'null');
      if (Array.isArray(saved)) open = saved.filter((v): v is string => typeof v === 'string');
    } catch {
      // Use each section's default.
    }
    this.openSections = new Set(open ?? []);
    const useDefaults = open === null;

    const format = readPref('format');
    if (FORMATS.some((f) => f.value === format)) this.format = format as ExportFormat;
    const scale = Number(readPref('pngScale'));
    if (scale === 1 || scale === 2 || scale === 4) this.pngScale = scale;
    const length = readPref('videoLength');
    if (length === 'loop' || length === '5' || length === '10') this.videoLength = length === 'loop' ? 'loop' : (Number(length) as 5 | 10);
    const shape = readPref('embedShape');
    if (SHAPES.some((s) => s.value === shape)) this.embedShape = shape as EmbedShape;
    this.embedOrbit = readPref('embedOrbit') !== 'off';

    this.left.replaceChildren(this.brand());
    for (const def of this.leftSections()) this.left.append(this.section(def, useDefaults));
    this.left.append(this.credit());
    this.right.replaceChildren();
    for (const def of this.rightSections()) this.right.append(this.section(def, useDefaults));

    store.subscribe((_, s) => this.sync(s));
    this.sync(store.value);
    this.syncExport();
  }

  // ─── Structure ───────────────────────────────────────────

  private brand(): HTMLElement {
    const mark = h('span', { class: 'logo-wrap', 'aria-hidden': 'true' });
    mark.innerHTML = LOGO_MARK;
    return h('div', { class: 'brand' }, mark.firstElementChild as HTMLElement, h('b', {}, 'ASCII 3D'), h('span', { class: 'ver' }, 'v1'));
  }

  private section(def: SectionDef, useDefaults: boolean): HTMLElement {
    const open = useDefaults ? def.open : this.openSections.has(def.id);
    if (open) this.openSections.add(def.id);
    const body = h('div', { class: 'body' });
    const details = h(
      'details',
      { class: 'sec fp', id: `sec-${def.id}`, open },
      h('summary', {}, si(def.icon), h('span', { class: 'st' }, def.title, h('em', {}, def.sub))),
      body,
    );
    def.build(body);
    details.addEventListener('toggle', () => {
      if (details.open) this.openSections.add(def.id);
      else this.openSections.delete(def.id);
      writePref('sections', JSON.stringify([...this.openSections]));
    });
    return details;
  }

  private add(body: HTMLElement, ...items: (Control | HTMLElement)[]): void {
    for (const item of items) {
      if (item instanceof HTMLElement) body.append(item);
      else {
        this.controls.push(item);
        body.append(item.el);
      }
    }
  }

  // ─── Left rail: what goes in, what comes out ─────────────

  private leftSections(): SectionDef[] {
    return [
      {
        id: 'model',
        icon: 'cube',
        title: 'Your model',
        sub: 'The 3D file and its animation',
        open: true,
        build: (body) => this.buildModel(body),
      },
      {
        id: 'look',
        icon: 'looks',
        title: 'Look',
        sub: 'Start from a finished style',
        open: true,
        build: (body) => this.buildLook(body),
      },
      {
        id: 'download',
        icon: 'export',
        title: 'Download',
        sub: 'Save a still, a clip or the text',
        open: true,
        build: (body) => this.buildDownload(body),
      },
      {
        id: 'embed',
        icon: 'code',
        title: 'Embed',
        sub: 'Put it on a website',
        open: false,
        build: (body) => this.buildEmbed(body),
      },
    ];
  }

  private buildModel(body: HTMLElement): void {
    const input = h('input', { type: 'file', id: 'model-file', multiple: true, accept: ACCEPTED_FILES, 'aria-label': 'Upload a 3D model' });
    const thumb = h('div', { class: 'thumb', 'aria-hidden': 'true' });
    thumb.innerHTML = LOGO_MARK;
    this.modelName = h('span', {}, 'GLB, glTF, FBX, OBJ or STL');
    const drop = h('div', { class: 'drop', id: 'drop-model' }, thumb, h('div', { class: 'meta' }, h('b', {}, '3D model'), this.modelName), input);
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (files.length) this.actions.loadFiles(files);
    });
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', () => drop.classList.remove('over'));

    this.sampleChips = SAMPLES.map((sample) => {
      const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', title: sample.hint, 'data-id': sample.id }, sample.label);
      chip.addEventListener('click', () => this.actions.loadSample(sample.id));
      return chip;
    });

    this.statsEl = h('p', { class: 'stats' });
    this.clipFsel = new Fsel('clip-select', 'Animation clip', []);
    this.clipFsel.onChange((v) => this.actions.playClip(Number(v)));
    this.motionBtn = button('Pause motion', { title: 'Pause or play all motion (Space)' }, 'pause');
    this.motionBtn.addEventListener('click', () => this.actions.toggleMotion());
    const speed = scrub(this.store, 'animSpeed', 'Speed', { unit: '×' });
    this.controls.push(speed);
    this.animBlock = h(
      'div',
      { class: 'body', style: 'padding:0' },
      grp('Animation'),
      h('div', { class: 'row2' }, h('label', { for: 'clip-select-btn' }, 'Clip'), this.clipFsel.el),
      speed.el,
      this.motionBtn,
    );
    this.animBlock.hidden = true;

    body.append(drop, grp('Samples'), h('div', { class: 'chips' }, ...this.sampleChips));

    if (this.features.network) {
      const url = h('input', {
        type: 'url',
        id: 'model-url',
        class: 'txt-in',
        placeholder: 'https://…/model.glb',
        spellcheck: 'false',
        'aria-label': 'Model URL',
      });
      const load = h('button', { type: 'button', class: 'btn ghost', style: 'width:auto' }, 'Load');
      const go = () => url.value.trim() && this.actions.loadUrl(url.value.trim());
      load.addEventListener('click', go);
      url.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      body.append(grp('From a link'), h('div', { class: 'btnrow', style: 'grid-template-columns:minmax(0,1fr) auto' }, url, load));
    }

    body.append(
      this.statsEl,
      this.animBlock,
      tip(
        'Drop a file anywhere on the page, or click the tile. A .gltf can come with its .bin and textures: select them together. Draco, Meshopt and KTX2 compression are supported.',
        'Files never leave your computer. To show an uploaded model on another website, use Embed below.',
      ),
    );
  }

  private lookOptions(): FselOption[] {
    const options: FselOption[] = PRESETS.map((preset) => {
      const look = presetSettings(preset);
      const ground = look.matchTheme ? THEME_GROUND[this.theme].bg : look.bg;
      const ink = look.matchTheme
        ? THEME_GROUND[this.theme].fg
        : look.colorMode === 'gradient'
          ? look.gradB
          : look.colorMode === 'mono'
            ? look.fg
            : '#8edcf0';
      return { value: preset.id, label: preset.name, group: PRESET_GROUPS[preset.group], swatch: { ground, ink } };
    });
    options.push({ value: 'custom', label: 'Custom', hidden: true });
    return options;
  }

  private buildLook(body: HTMLElement): void {
    this.lookFsel = new Fsel('look-select', 'Look', this.lookOptions());
    this.lookFsel.onChange((v) => v !== 'custom' && this.actions.applyPreset(v));
    const reset = button('Reset everything', { title: 'Restore every setting to its default' }, 'undo');
    reset.addEventListener('click', () => this.actions.resetAll());
    body.append(
      h('div', { class: 'row2' }, h('label', { for: 'look-select-btn' }, 'Style'), this.lookFsel.el),
      reset,
      tip(
        'Each look sets the glyphs, colours, shading and effects in one step; every control stays yours to change afterwards. Mono follows the light and dark switch above the render.',
        'Keys 1 to 9 and 0 pick a look, X picks a random one.',
      ),
    );
  }

  private buildDownload(body: HTMLElement): void {
    const name = h('input', { class: 'txt-in', id: 'export-name', value: this.fileName, maxlength: 40, spellcheck: 'false' });
    name.addEventListener('input', () => (this.fileName = name.value.trim()));

    const format = new Fsel('export-format', 'Format', FORMATS);
    format.value = this.format;
    format.onChange((v) => {
      this.format = v as ExportFormat;
      writePref('format', v);
      this.syncExport();
    });
    const scale = new Fsel('export-scale', 'Scale', [
      { value: '1', label: '1× the screen' },
      { value: '2', label: '2× the screen' },
      { value: '4', label: '4× the screen' },
    ]);
    scale.value = String(this.pngScale);
    scale.onChange((v) => {
      this.pngScale = Number(v) as PngScale;
      writePref('pngScale', v);
    });
    const length = new Fsel('export-length', 'Length', [
      { value: 'loop', label: 'One full turn' },
      { value: '5', label: '5 seconds' },
      { value: '10', label: '10 seconds' },
    ]);
    length.value = String(this.videoLength);
    length.onChange((v) => {
      this.videoLength = v === 'loop' ? 'loop' : (Number(v) as 5 | 10);
      writePref('videoLength', v);
    });

    this.scaleField = h('div', { class: 'field' }, h('label', { for: 'export-scale-btn' }, 'Scale'), scale.el);
    this.lengthField = h('div', { class: 'field' }, h('label', { for: 'export-length-btn' }, 'Length'), length.el);
    const transparent = toggle(this.store, 'transparentBg', 'Transparent background');
    this.controls.push(transparent);
    this.transparentField = transparent.el;

    this.exportBtn = h('button', { type: 'button', class: 'btn primary', id: 'btn-export' });
    this.exportBtn.addEventListener('click', () => this.actions.runExport());
    const copy = button('Copy ASCII text', { id: 'btn-copy-text' }, 'copy');
    copy.addEventListener('click', () => this.actions.copyText());
    const loadLook = button('Load a look file', { id: 'btn-load-look' }, 'file');
    loadLook.addEventListener('click', () => this.actions.loadLook());

    body.append(
      h('div', { class: 'row2' }, h('label', { for: 'export-name' }, 'File name'), name),
      h('div', { class: 'field' }, h('label', { for: 'export-format-btn' }, 'Format'), format.el),
      this.scaleField,
      this.lengthField,
      this.transparentField,
      h('div', { class: 'btns' }, this.exportBtn, copy, loadLook),
      tip(
        'Everything is saved from the frame between the panels. PNG goes up to 4× the screen; video records in real time, and One full turn loops seamlessly. SVG keeps every glyph as real, editable text for Figma or Illustrator.',
      ),
    );
  }

  private buildEmbed(body: HTMLElement): void {
    const shape = new Fsel('embed-shape', 'Shape', SHAPES);
    shape.value = this.embedShape;
    shape.onChange((v) => {
      this.embedShape = v as EmbedShape;
      writePref('embedShape', v);
    });
    const orbitInput = h('input', { type: 'checkbox', id: 'embed-orbit' });
    orbitInput.checked = this.embedOrbit;
    orbitInput.addEventListener('change', () => {
      this.embedOrbit = orbitInput.checked;
      writePref('embedOrbit', orbitInput.checked ? 'on' : 'off');
    });

    // A model anyone can reach (a sample or a public link): one click.
    const copyCode = h('button', { type: 'button', class: 'btn primary', id: 'btn-embed-code' }, svg('code'), h('span', {}, 'Copy embed code'));
    copyCode.addEventListener('click', () => this.actions.copyEmbedCode());
    const copyLink = button('Copy link to this look', { id: 'btn-share-link' }, 'link');
    copyLink.addEventListener('click', () => this.actions.copyShareLink());
    this.publicBlock = h(
      'div',
      { class: 'btns' },
      h('p', { class: 'note' }, 'This model is already online, so the code works as it is: paste it into any page.'),
      copyCode,
      copyLink,
    );

    // A model that only exists on this computer: package it, host it, then paste its link.
    const zip = h('button', { type: 'button', class: 'btn primary', id: 'btn-embed-zip', title: 'A folder for vercel.com/drop: index.html and model.glb' });
    zip.addEventListener('click', () => this.actions.downloadEmbed('zip'));
    const html = h('button', { type: 'button', class: 'btn ghost', id: 'btn-embed-html', title: 'One .html file with the model inside it' });
    html.addEventListener('click', () => this.actions.downloadEmbed('html'));
    this.embedButtons = { zip, html };
    this.setEmbedBusy(null);
    this.hostedInput = h('input', {
      type: 'url',
      class: 'txt-in',
      id: 'embed-url',
      placeholder: 'https://your-embed.vercel.app',
      spellcheck: 'false',
      'aria-label': 'Link to the hosted embed',
    });
    const copyHosted = h('button', { type: 'button', class: 'btn primary', id: 'btn-embed-hosted' }, svg('code'), h('span', {}, 'Copy embed code'));
    copyHosted.addEventListener('click', () => this.actions.copyHostedEmbed(this.hostedInput.value.trim()));
    this.hostedInput.addEventListener('keydown', (e) => e.key === 'Enter' && copyHosted.click());
    this.privateBlock = h(
      'ol',
      { class: 'steps' },
      h(
        'li',
        {},
        h(
          'div',
          {},
          h('span', {}, h('b', {}, 'Download the embed. '), 'Your model and this look, ready to host: a .zip for Vercel, or one .html file.'),
          h('div', { class: 'btnrow' }, zip, html),
        ),
      ),
      h(
        'li',
        {},
        h(
          'div',
          {},
          h(
            'span',
            {},
            h('b', {}, 'Put it online. '),
            'Drag the .zip onto ',
            h('a', { href: 'https://vercel.com/drop', target: '_blank', rel: 'noopener' }, 'vercel.com/drop'),
            ', or upload the .html to any web host.',
          ),
        ),
      ),
      h(
        'li',
        {},
        h('div', {}, h('span', {}, h('b', {}, 'Paste its link here. '), 'You get the code to put on your site.'), this.hostedInput, copyHosted),
      ),
    );

    this.codeBox = h('pre', { class: 'codebox', id: 'embed-code', hidden: true });

    body.append(
      h('div', { class: 'row2' }, h('label', { for: 'embed-shape-btn' }, 'Shape'), shape.el),
      h('label', { class: 'chk' }, orbitInput, 'Drag to orbit'),
      this.publicBlock,
      this.privateBlock,
      this.codeBox,
      tip(
        'An embed is a page that shows the render full-bleed and nothing else, placed on your site with an <iframe>.',
        'An uploaded model only exists on your computer, so it has to be put online before another site can show it. The embed download carries the renderer, the model and the look and needs nothing else, so it works on any host and keeps working even if this tool moves.',
      ),
    );
  }

  private credit(): HTMLElement {
    const tour = h('button', { type: 'button', class: 'credit-tour', id: 'btn-tour' }, 'Take the tour again');
    tour.addEventListener('click', () => this.actions.startTour());
    const keys: [string, string][] = [
      ['Space', 'Pause or play motion'],
      ['X', 'Random look'],
      ['1–0', 'Pick a look'],
      ['S', 'Save a PNG'],
      ['R', 'Reset the view'],
      ['H', 'Hide the panels'],
      ['F', 'Full screen'],
      ['U', 'Upload a model'],
    ];
    const shortcuts = h(
      'details',
      { class: 'tip', style: 'margin-top:10px' },
      h('summary', {}, 'Keyboard shortcuts'),
      h('dl', { class: 'keys' }, ...keys.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])),
    );
    return h(
      'div',
      { class: 'credit fp' },
      h('b', {}, 'ASCII 3D'),
      'Designed & built by ',
      h('span', {}, '@btrxinfinity'),
      h(
        'em',
        {},
        'Fox sample: PixelMannen (CC0); rigging and animation by tomkranis, glTF by AsoboStudio and scurest (CC BY 4.0), from the ',
        h('a', { href: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox', target: '_blank', rel: 'noopener' }, 'Khronos samples'),
        '. Rendering by three.js. Interface icons by Iconoir, MIT.',
      ),
      shortcuts,
      tour,
    );
  }

  // ─── Right rail: how it looks ────────────────────────────

  private rightSections(): SectionDef[] {
    const { store } = this;
    return [
      {
        id: 'glyphs',
        icon: 'type',
        title: 'Glyphs',
        sub: 'Characters, cell size and font',
        open: true,
        build: (body) => {
          const ramp = h('pre', { class: 'ramp', 'aria-label': 'Character ramp, light to dense' });
          this.add(
            body,
            selectRow(
              store,
              'charset',
              'Set',
              (Object.keys(CHARSETS) as CharsetId[]).map((id) => ({ value: id, label: CHARSETS[id].label })),
            ),
            textField(store, 'customChars', 'Your characters, light to dense', {
              placeholder: ' .:-=+*#%@',
              when: (s) => s.charset === 'custom',
            }),
            custom(ramp, (s) => {
              const text = rampFor(s).map((c) => (c === ' ' ? '·' : c)).join('');
              if (ramp.textContent !== text) ramp.textContent = text;
              const family = FONTS[s.font].family;
              ramp.style.fontFamily = family ? `"${family}", var(--mono)` : 'var(--mono)';
            }),
            scrub(store, 'cellSize', 'Cell size', { unit: ' px' }),
            scrub(store, 'charAspect', 'Character width'),
            scrub(store, 'glyphScale', 'Glyph scale', { scale: 100, unit: '%' }),
            selectRow(
              store,
              'font',
              'Font',
              (Object.keys(FONTS) as FontId[]).map((id) => ({ value: id, label: FONTS[id].label })),
            ),
            toggle(store, 'bold', 'Bold'),
            tip(
              'Every cell of the render becomes one character, picked from the set by how bright the cell is: the first character is the lightest, the last the densest. Smaller cells show more detail.',
            ),
          );
        },
      },
      {
        id: 'tone',
        icon: 'contrast',
        title: 'Tone',
        sub: 'How brightness becomes density',
        open: false,
        build: (body) => {
          this.add(
            body,
            scrub(store, 'exposure', 'Exposure'),
            scrub(store, 'brightness', 'Brightness'),
            scrub(store, 'contrast', 'Contrast'),
            scrub(store, 'gamma', 'Gamma'),
            scrub(store, 'threshold', 'Cutoff'),
            scrub(store, 'dither', 'Dither'),
            toggle(store, 'invert', 'Invert'),
            toggle(store, 'fillSilhouette', 'Fill the silhouette'),
            toggle(store, 'edges', 'Edge lines'),
            scrub(store, 'edgeThreshold', 'Edge sensitivity', { when: (s) => s.edges }),
            tip(
              'Contrast and gamma shape which character each cell gets; cells darker than the cutoff stay empty. Invert prints dense glyphs where the model is dark. Edge lines outline shapes with | / - \\.',
            ),
          );
        },
      },
      {
        id: 'color',
        icon: 'droplet',
        title: 'Colour',
        sub: 'Glyphs, ground and accent',
        open: false,
        build: (body) => {
          const bar = h('div', { class: 'gradbar', 'aria-hidden': 'true' });
          const own = (s: Readonly<Settings>) => !s.matchTheme;
          this.add(
            body,
            toggle(store, 'matchTheme', 'Match the interface theme'),
            selectRow(store, 'colorMode', 'Glyphs', entries(COLOR_MODES), { when: own }),
            colorRow(store, 'fg', 'Glyph', { when: (s) => own(s) && s.colorMode === 'mono' }),
            colorRow(store, 'gradA', 'Shadows', { when: (s) => own(s) && s.colorMode === 'gradient' }),
            colorRow(store, 'gradB', 'Midtones', { when: (s) => own(s) && s.colorMode === 'gradient' }),
            colorRow(store, 'gradC', 'Highlights', { when: (s) => own(s) && s.colorMode === 'gradient' }),
            custom(
              bar,
              (s) => (bar.style.background = `linear-gradient(to right, ${s.gradA}, ${s.gradB}, ${s.gradC})`),
              (s) => own(s) && s.colorMode === 'gradient',
            ),
            scrub(store, 'colorBoost', 'Colour boost', { when: (s) => own(s) && s.colorMode === 'original' }),
            scrub(store, 'saturation', 'Saturation', { when: (s) => own(s) && s.colorMode === 'original' }),
            colorRow(store, 'bg', 'Ground', { when: (s) => own(s) && !s.transparentBg }),
            colorRow(store, 'accent', 'Accent', { when: own }),
            toggle(store, 'transparentBg', 'Transparent background'),
            tip(
              'Matching the theme prints ink on white in light mode and white on black in dark mode. Otherwise glyphs take the model’s own colours, one colour, or a gradient from shadows to highlights. The accent colours the scan beam, the cursor lens and the background field.',
            ),
          );
        },
      },
      {
        id: 'light',
        icon: 'sun',
        title: 'Light',
        sub: 'Shading and lighting',
        open: false,
        build: (body) => {
          this.add(
            body,
            selectRow(store, 'shading', 'Shading', entries(SHADINGS)),
            colorRow(store, 'baseColor', 'Surface', {
              when: (s) => s.shading === 'clay' || s.shading === 'toon' || s.shading === 'wireframe',
            }),
            toggle(store, 'flatShading', 'Faceted', { when: (s) => s.shading === 'clay' || s.shading === 'normal' }),
            grp('Key light'),
            scrub(store, 'lightAzimuth', 'Direction', { unit: '°' }),
            scrub(store, 'lightElevation', 'Height', { unit: '°' }),
            scrub(store, 'lightIntensity', 'Strength'),
            grp('Fill'),
            scrub(store, 'rim', 'Rim light'),
            scrub(store, 'ambient', 'Ambient'),
            scrub(store, 'envIntensity', 'Reflections'),
            tip(
              'The key light sits relative to the view, so the shading reads the same from any angle. Original keeps the model’s materials; Clay, Toon, Normals, Depth and Wire replace them for a cleaner read.',
            ),
          );
        },
      },
      {
        id: 'motion',
        icon: 'orbit',
        title: 'Motion',
        sub: 'Spin, float and framing',
        open: false,
        build: (body) => {
          const reset = button('Reset the view', { title: 'Reset camera (R)' }, 'target');
          reset.addEventListener('click', () => this.actions.resetView());
          this.add(
            body,
            scrub(store, 'spin', 'Turntable', { unit: '°/s' }),
            scrub(store, 'float', 'Float'),
            scrub(store, 'follow', 'Follow the cursor'),
            scrub(store, 'fov', 'Field of view', { unit: '°' }),
            selectRow(store, 'frame', 'Frame', entries(FRAMES)),
            reset,
            tip(
              'Drag the render to orbit and scroll to zoom. Frame fixes the shape that downloads capture; Fill uses the whole space between the panels.',
            ),
          );
        },
      },
      {
        id: 'effects',
        icon: 'sparkles',
        title: 'Effects',
        sub: 'Scan beam, glow and texture',
        open: false,
        build: (body) => {
          this.add(
            body,
            toggle(store, 'scan', 'Scan beam'),
            selectRow(store, 'scanDirection', 'Direction', entries(SCAN_DIRECTIONS), { when: (s) => s.scan }),
            scrub(store, 'scanSpeed', 'Sweeps per second', { when: (s) => s.scan }),
            scrub(store, 'scanWidth', 'Trail', { when: (s) => s.scan }),
            scrub(store, 'scanGlitch', 'Scramble', { when: (s) => s.scan }),
            toggle(store, 'lens', 'Cursor lens'),
            scrub(store, 'lensRadius', 'Lens size', { unit: ' px', when: (s) => s.lens }),
            grp('Glow'),
            scrub(store, 'glow', 'Glow'),
            scrub(store, 'glowRadius', 'Spread', { when: (s) => s.glow > 0 }),
            scrub(store, 'glowThreshold', 'Threshold', { when: (s) => s.glow > 0 }),
            grp('Texture'),
            scrub(store, 'noise', 'Flicker'),
            scrub(store, 'field', 'Background field'),
            scrub(store, 'grid', 'Cell grid'),
            scrub(store, 'crt', 'CRT lines'),
            scrub(store, 'vignette', 'Vignette'),
            toggle(store, 'reveal', 'Decode on load'),
            tip(
              'The scan beam sweeps the frame, scrambling and tinting glyphs as it passes. The cursor lens decodes glyphs under the pointer. Glow works best on dark grounds.',
            ),
          );
        },
      },
    ];
  }

  // ─── Updates ─────────────────────────────────────────────

  private activePreset(): string {
    const s = this.store.value;
    const match = PRESETS.find((preset) => {
      const look = presetSettings(preset);
      return SETTING_KEYS.every((key) => PRESET_IGNORED.includes(key) || look[key] === s[key]);
    });
    return match?.id ?? 'custom';
  }

  private sync(s: Readonly<Settings>): void {
    for (const control of this.controls) {
      if (control.when) control.el.hidden = !control.when(s);
      control.sync(s);
    }
    this.lookFsel.value = this.activePreset();
  }

  private syncExport(): void {
    const labels: Record<ExportFormat, string> = {
      png: 'Export PNG',
      video: 'Start recording',
      svg: 'Export SVG',
      txt: 'Export text',
      json: 'Save the look',
    };
    this.exportBtn.replaceChildren(svg(this.format === 'video' ? 'video' : 'export'), h('span', {}, labels[this.format]));
    this.scaleField.hidden = this.format !== 'png';
    this.lengthField.hidden = this.format !== 'video';
    this.transparentField.hidden = this.format !== 'png' && this.format !== 'svg';
  }

  setTheme(theme: UiTheme): void {
    this.theme = theme;
    this.lookFsel.setOptions(this.lookOptions());
    this.lookFsel.value = this.activePreset();
  }

  setModel(info: ModelInfo | null, activeClip: number, publicModel: boolean): void {
    this.publicModel = publicModel && this.features.network;
    const source = info?.source;
    this.modelName.textContent = info ? info.name : 'GLB, glTF, FBX, OBJ or STL';
    this.sampleChips.forEach((chip) =>
      chip.setAttribute('aria-pressed', String(source?.kind === 'sample' && source.id === chip.dataset.id)),
    );
    this.statsEl.textContent = info
      ? [
          `${formatCount(info.triangles)} triangles`,
          `${info.meshes} mesh${info.meshes === 1 ? '' : 'es'}`,
          info.clips.length ? `${info.clips.length} clip${info.clips.length === 1 ? '' : 's'}` : 'no animation',
        ].join(' · ')
      : '';
    const clips = info?.clips ?? [];
    this.animBlock.hidden = clips.length === 0;
    this.clipFsel.setOptions(clips.map((name, i) => ({ value: String(i), label: name })));
    if (clips.length) this.clipFsel.value = String(Math.max(0, activeClip));
    if (!this.fileName || this.fileName === 'ascii3d' || this.fileName.startsWith('ascii3d-')) {
      this.fileName = info ? `ascii3d-${info.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : 'ascii3d';
      const input = document.getElementById('export-name') as HTMLInputElement | null;
      if (input) input.value = this.fileName;
    }
    this.publicBlock.hidden = !this.publicModel;
    this.privateBlock.hidden = this.publicModel;
    this.codeBox.hidden = true;
  }

  /** While an embed is being packed, its button says so and neither can be pressed twice. */
  setEmbedBusy(kind: 'zip' | 'html' | null): void {
    for (const key of ['zip', 'html'] as const) {
      const btn = this.embedButtons[key];
      btn.disabled = kind !== null;
      btn.replaceChildren(svg('export'), h('span', {}, kind === key ? 'Packing…' : `.${key}`));
    }
  }

  showEmbedCode(code: string): void {
    this.codeBox.textContent = code;
    this.codeBox.hidden = false;
  }

  setMotionPaused(paused: boolean): void {
    this.motionBtn.replaceChildren(svg(paused ? 'play' : 'pause'), h('span', {}, paused ? 'Play motion' : 'Pause motion'));
  }

  setRecording(recording: boolean, label?: string): void {
    if (this.format !== 'video') return;
    this.exportBtn.replaceChildren(
      svg(recording ? 'stop' : 'video'),
      h('span', {}, recording ? (label ?? 'Stop recording') : 'Start recording'),
    );
  }
}
