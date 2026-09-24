import {
  CHARSETS,
  FONTS,
  SCAN_DIRECTIONS,
  defaultSettings,
  type CharsetId,
  type FontId,
  type ScanDirection,
  type Settings,
} from './schema';

export type PresetGroup = 'theme' | 'dark' | 'light';

export interface Preset {
  id: string;
  name: string;
  group: PresetGroup;
  /** One line shown under the name. */
  hint: string;
  /** Overrides applied on top of the defaults, so every preset is a complete look. */
  settings: Partial<Settings>;
}

export const PRESET_GROUPS: Record<PresetGroup, string> = {
  theme: 'Follows the theme',
  dark: 'Dark grounds',
  light: 'Light and coloured grounds',
};

/** The shared base of the looks that set their own dark ground. */
const DARK_BASE: Partial<Settings> = {
  matchTheme: false,
  colorMode: 'gradient',
  fg: '#f2e6d0',
  gradA: '#4a3b2a',
  gradB: '#d9a866',
  gradC: '#fff4de',
  bg: '#0b0c0e',
  accent: '#8edcf0',
  glow: 0.22,
  glowThreshold: 0.4,
  field: 0.035,
  vignette: 0.35,
  noise: 0.04,
};

export const PRESETS: Preset[] = [
  {
    id: 'mono',
    name: 'Mono',
    group: 'theme',
    hint: 'Ink on white, or white on black: follows the light and dark switch',
    settings: {},
  },
  {
    id: 'scanner',
    name: 'Scanner',
    group: 'dark',
    hint: 'Sand-toned glyphs with a cyan sensor sweep',
    settings: { ...DARK_BASE },
  },
  {
    id: 'textured',
    name: 'Textured',
    group: 'dark',
    hint: "The model's own textures and colours, fine detail",
    settings: {
      ...DARK_BASE,
      shading: 'original',
      colorMode: 'original',
      colorBoost: 0.55,
      saturation: 1.2,
      charset: 'detailed',
      cellSize: 9,
      exposure: 1.35,
      envIntensity: 0.9,
      lightIntensity: 1.8,
      rim: 0.9,
      glow: 0.25,
      field: 0.06,
      scanGlitch: 0.35,
    },
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    group: 'dark',
    hint: 'Green terminal phosphor with CRT lines',
    settings: {
      ...DARK_BASE,
      charset: 'code',
      font: 'vt323',
      cellSize: 13,
      charAspect: 0.5,
      gradA: '#0c2b16',
      gradB: '#39d67a',
      gradC: '#dcffe8',
      bg: '#030806',
      accent: '#c4ffd8',
      crt: 0.6,
      vignette: 0.65,
      glow: 0.45,
      glowThreshold: 0.25,
      field: 0.04,
      noise: 0.08,
    },
  },
  {
    id: 'amber',
    name: 'Amber CRT',
    group: 'dark',
    hint: 'Monochrome amber monitor',
    settings: {
      ...DARK_BASE,
      font: 'vt323',
      cellSize: 14,
      charAspect: 0.52,
      colorMode: 'mono',
      fg: '#ffb23f',
      bg: '#0d0802',
      accent: '#fff0c2',
      crt: 0.75,
      vignette: 0.7,
      glow: 0.5,
      glowThreshold: 0.3,
      scanDirection: 'up',
      scanSpeed: 0.1,
      field: 0,
      noise: 0.06,
    },
  },
  {
    id: 'chroma',
    name: 'Chroma',
    group: 'dark',
    hint: 'Surface normals mapped to colour, block glyphs',
    settings: {
      ...DARK_BASE,
      shading: 'normal',
      colorMode: 'original',
      colorBoost: 0.6,
      saturation: 1.35,
      charset: 'blocks',
      cellSize: 10,
      bg: '#08080b',
      glow: 0.18,
      scan: false,
      field: 0.05,
      accent: '#ffffff',
    },
  },
  {
    id: 'thermal',
    name: 'Thermal',
    group: 'dark',
    hint: 'Depth rendered as a heat map with a radial pulse',
    settings: {
      ...DARK_BASE,
      shading: 'depth',
      gradA: '#240b4d',
      gradB: '#e0356f',
      gradC: '#ffd86b',
      bg: '#07030f',
      accent: '#fff3b0',
      charset: 'signal',
      scanDirection: 'radial',
      scanSpeed: 0.3,
      glow: 0.4,
      contrast: 1.3,
      field: 0.05,
    },
  },
  {
    id: 'braille',
    name: 'Braille',
    group: 'dark',
    hint: 'Fine braille-dot stipple, no effects',
    settings: {
      ...DARK_BASE,
      charset: 'dots',
      colorMode: 'mono',
      fg: '#eef1f6',
      cellSize: 8,
      charAspect: 0.55,
      glow: 0.15,
      scan: false,
      lens: false,
      noise: 0,
      field: 0,
      vignette: 0.2,
      reveal: false,
    },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    group: 'light',
    hint: 'Outlined drawing on drafting blue with a cell grid',
    settings: {
      ...DARK_BASE,
      bg: '#0f2f6e',
      colorMode: 'mono',
      fg: '#e6eeff',
      accent: '#ffffff',
      edges: true,
      edgeThreshold: 0.45,
      grid: 0.1,
      glow: 0,
      field: 0,
      vignette: 0.15,
      scanDirection: 'right',
      scanGlitch: 0.3,
      lightIntensity: 1.7,
      rim: 0.6,
    },
  },
  {
    id: 'newsprint',
    name: 'Newsprint',
    group: 'light',
    hint: 'Ink on paper: shadows print dense, highlights stay open',
    settings: {
      ...DARK_BASE,
      bg: '#efebe3',
      colorMode: 'mono',
      fg: '#1b1a1f',
      accent: '#c7362a',
      invert: true,
      charset: 'detailed',
      cellSize: 9,
      exposure: 0.55,
      contrast: 1.5,
      lightIntensity: 1.3,
      glow: 0,
      field: 0,
      vignette: 0,
      scan: false,
      noise: 0,
      rim: 0.4,
      ambient: 0.2,
    },
  },
];

export function presetSettings(preset: Preset): Settings {
  return { ...defaultSettings(), ...preset.settings };
}

/** Palettes for Randomize: [ground, dark, mid, light, accent]. */
const PALETTES: [string, string, string, string, string][] = [
  ['#0b0c0e', '#4a3b2a', '#d9a866', '#fff4de', '#8edcf0'],
  ['#05070d', '#12305c', '#3f8efc', '#e1efff', '#ffd166'],
  ['#0a0507', '#4d1024', '#ef476f', '#ffe3ea', '#06d6a0'],
  ['#030806', '#0c2b16', '#39d67a', '#dcffe8', '#c4ffd8'],
  ['#0f0c08', '#3d2a12', '#ff9f1c', '#fff1d6', '#2ec4b6'],
  ['#07030f', '#240b4d', '#e0356f', '#ffd86b', '#fff3b0'],
  ['#0c0d10', '#2b2f38', '#9aa3b5', '#f4f6fb', '#ff5d5d'],
  ['#060b0b', '#123b3b', '#2fb7a8', '#e2fffb', '#ffb4a2'],
];

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const range = (min: number, max: number, step = 0.01) =>
  Math.round((min + Math.random() * (max - min)) / step) * step;

/** A random but tasteful look. Model, camera and framing are left alone. */
export function randomLook(current: Settings): Partial<Settings> {
  const [bg, a, b, c, accent] = pick(PALETTES);
  const charsets = (Object.keys(CHARSETS) as CharsetId[]).filter((id) => id !== 'custom');
  const fonts = (Object.keys(FONTS) as FontId[]).filter((id) => id !== 'system');
  const colorMode = pick(['gradient', 'gradient', 'mono', 'original'] as const);
  return {
    matchTheme: false,
    charset: pick(charsets),
    font: pick(fonts),
    cellSize: Math.round(range(8, 15, 1)),
    charAspect: range(0.5, 0.75),
    colorMode,
    bg,
    gradA: a,
    gradB: b,
    gradC: c,
    fg: c,
    accent,
    invert: false,
    shading: colorMode === 'original' ? pick(['normal', 'original'] as const) : pick(['clay', 'clay', 'toon', 'depth'] as const),
    contrast: range(0.95, 1.5),
    edges: Math.random() < 0.25,
    scan: Math.random() < 0.75,
    scanDirection: pick(Object.keys(SCAN_DIRECTIONS) as ScanDirection[]),
    scanSpeed: range(0.08, 0.35),
    glow: range(0, 0.5),
    field: Math.random() < 0.5 ? range(0.02, 0.12) : 0,
    crt: Math.random() < 0.3 ? range(0.3, 0.8) : 0,
    grid: Math.random() < 0.2 ? range(0.05, 0.15) : 0,
    noise: range(0, 0.12),
    vignette: range(0.1, 0.6),
    lightAzimuth: Math.round(range(-80, 80, 1)),
    lightElevation: Math.round(range(10, 60, 1)),
    spin: current.spin,
    frame: current.frame,
  };
}
