/**
 * Every tunable setting, its default, and its valid range. The UI, storage,
 * share links and preset import all validate against this one table.
 */

export const CHARSETS = {
  standard: { label: 'Standard', chars: ' .:-=+*#%@' },
  detailed: {
    label: 'Detailed (70 levels)',
    chars: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  blocks: { label: 'Blocks', chars: ' ░▒▓█' },
  dots: { label: 'Braille dots', chars: ' ⠁⠃⠇⡇⣇⣧⣷⣿' },
  binary: { label: 'Binary', chars: ' 01' },
  code: { label: 'Code', chars: ' .,:;i1tfLCG08@' },
  signal: { label: 'Signal', chars: ' ·:+×xX#' },
  custom: { label: 'Custom…', chars: '' },
} as const;

export type CharsetId = keyof typeof CHARSETS;

export const FONTS = {
  jetbrains: { label: 'JetBrains Mono', family: 'JetBrains Mono' },
  plex: { label: 'IBM Plex Mono', family: 'IBM Plex Mono' },
  martian: { label: 'Martian Mono', family: 'Martian Mono' },
  space: { label: 'Space Mono', family: 'Space Mono' },
  courier: { label: 'Courier Prime', family: 'Courier Prime' },
  vt323: { label: 'VT323 (terminal)', family: 'VT323' },
  system: { label: 'System monospace', family: '' },
} as const;

export type FontId = keyof typeof FONTS;

export const SHADINGS = {
  original: 'Original',
  clay: 'Clay',
  toon: 'Toon',
  normal: 'Normals',
  depth: 'Depth',
  wireframe: 'Wire',
} as const;
export type Shading = keyof typeof SHADINGS;

export const COLOR_MODES = { original: 'Model', mono: 'Solid', gradient: 'Gradient' } as const;
export type ColorMode = keyof typeof COLOR_MODES;

export const SCAN_DIRECTIONS = {
  down: 'Top → bottom',
  up: 'Bottom → top',
  right: 'Left → right',
  left: 'Right → left',
  radial: 'Radial pulse',
} as const;
export type ScanDirection = keyof typeof SCAN_DIRECTIONS;

export const FRAMES = {
  fill: 'Fill window',
  '16:9': '16:9 landscape',
  '4:3': '4:3',
  '1:1': '1:1 square',
  '4:5': '4:5 portrait',
  '9:16': '9:16 story',
} as const;
export type FrameId = keyof typeof FRAMES;

type NumberSpec = { kind: 'number'; default: number; min: number; max: number; step: number };
type BoolSpec = { kind: 'bool'; default: boolean };
type ColorSpec = { kind: 'color'; default: string };
type TextSpec = { kind: 'text'; default: string; maxLength: number };
type EnumSpec<T extends string> = { kind: 'enum'; default: T; values: readonly T[] };

const num = (d: number, min: number, max: number, step: number): NumberSpec => ({
  kind: 'number',
  default: d,
  min,
  max,
  step,
});
const bool = (d: boolean): BoolSpec => ({ kind: 'bool', default: d });
const color = (d: string): ColorSpec => ({ kind: 'color', default: d });
const oneOf = <T extends string>(values: readonly T[], d: T): EnumSpec<T> => ({ kind: 'enum', default: d, values });
const keysOf = <T extends object>(o: T) => Object.keys(o) as (keyof T & string)[];

export const SCHEMA = {
  // Glyphs
  charset: oneOf(keysOf(CHARSETS), 'standard'),
  customChars: { kind: 'text', default: ' .oO@', maxLength: 96 } as TextSpec,
  cellSize: num(10, 4, 40, 1),
  charAspect: num(0.62, 0.35, 1.2, 0.01),
  glyphScale: num(1, 0.5, 1.6, 0.01),
  font: oneOf(keysOf(FONTS), 'jetbrains'),
  bold: bool(false),

  // Tone mapping of brightness → character density
  exposure: num(1, 0.1, 4, 0.01),
  brightness: num(0, -1, 1, 0.01),
  contrast: num(1.25, 0.2, 3, 0.01),
  gamma: num(1, 0.3, 3, 0.01),
  threshold: num(0.02, 0, 0.9, 0.01),
  dither: num(0, 0, 1, 0.01),
  invert: bool(false),
  fillSilhouette: bool(true),
  edges: bool(false),
  edgeThreshold: num(0.55, 0.05, 2, 0.01),

  // Color. With matchTheme on, glyphs, ground and accent follow the interface
  // theme (ink on white in light mode, white on near-black in dark mode).
  matchTheme: bool(true),
  colorMode: oneOf(keysOf(COLOR_MODES), 'mono'),
  fg: color('#18181b'),
  gradA: color('#4a3b2a'),
  gradB: color('#d9a866'),
  gradC: color('#fff4de'),
  colorBoost: num(0.5, 0, 1, 0.01),
  saturation: num(1, 0, 2, 0.01),
  bg: color('#ffffff'),
  transparentBg: bool(false),
  accent: color('#71717a'),

  // Model
  shading: oneOf(keysOf(SHADINGS), 'clay'),
  baseColor: color('#ffffff'),
  flatShading: bool(false),

  // Lighting (key light is camera-relative, so shading stays stable while orbiting)
  lightAzimuth: num(-35, -180, 180, 1),
  lightElevation: num(35, -89, 89, 1),
  lightIntensity: num(1.5, 0, 8, 0.05),
  ambient: num(0.15, 0, 3, 0.01),
  rim: num(1.2, 0, 6, 0.05),
  envIntensity: num(0.25, 0, 3, 0.01),

  // Motion
  spin: num(14, -120, 120, 1),
  float: num(0.25, 0, 1, 0.01),
  follow: num(0.35, 0, 1, 0.01),
  fov: num(35, 15, 90, 1),
  frame: oneOf(keysOf(FRAMES), 'fill'),
  animSpeed: num(1, 0, 3, 0.05),

  // Effects
  scan: bool(true),
  scanDirection: oneOf(keysOf(SCAN_DIRECTIONS), 'down'),
  scanSpeed: num(0.16, 0.02, 1.5, 0.01),
  scanWidth: num(0.18, 0.02, 0.8, 0.01),
  scanGlitch: num(0.6, 0, 1, 0.01),
  lens: bool(true),
  lensRadius: num(90, 20, 400, 1),
  noise: num(0.03, 0, 1, 0.01),
  glow: num(0, 0, 1.5, 0.01),
  glowRadius: num(0.45, 0, 1, 0.01),
  glowThreshold: num(0.4, 0, 1, 0.01),
  field: num(0, 0, 1, 0.01),
  grid: num(0, 0, 1, 0.01),
  crt: num(0, 0, 1, 0.01),
  vignette: num(0, 0, 1, 0.01),
  reveal: bool(true),
} as const;

type Schema = typeof SCHEMA;
type ValueOf<S> = S extends NumberSpec
  ? number
  : S extends BoolSpec
    ? boolean
    : S extends EnumSpec<infer T>
      ? T
      : string;

export type Settings = { -readonly [K in keyof Schema]: ValueOf<Schema[K]> };
export type SettingKey = keyof Settings;

export const SETTING_KEYS = Object.keys(SCHEMA) as SettingKey[];

export function defaultSettings(): Settings {
  const out = {} as Record<string, unknown>;
  for (const key of SETTING_KEYS) out[key] = SCHEMA[key].default;
  return out as Settings;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Returns a valid value for `key`, or undefined if `value` can't be coerced. */
export function sanitizeValue<K extends SettingKey>(key: K, value: unknown): Settings[K] | undefined {
  const spec = SCHEMA[key] as NumberSpec | BoolSpec | ColorSpec | TextSpec | EnumSpec<string>;
  switch (spec.kind) {
    case 'number': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
      return Math.min(spec.max, Math.max(spec.min, n)) as Settings[K];
    }
    case 'bool':
      return typeof value === 'boolean' ? (value as Settings[K]) : undefined;
    case 'color': {
      if (typeof value !== 'string') return undefined;
      const v = value.trim();
      if (HEX.test(v)) return v.toLowerCase() as Settings[K];
      if (/^#[0-9a-f]{3}$/i.test(v)) {
        return ('#' + [...v.slice(1)].map((c) => c + c).join('')).toLowerCase() as Settings[K];
      }
      return undefined;
    }
    case 'text':
      return typeof value === 'string' ? (value.slice(0, spec.maxLength) as Settings[K]) : undefined;
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value) ? (value as Settings[K]) : undefined;
  }
}

/** Keeps only known keys with valid values. Unknown or invalid entries are dropped. */
export function sanitizeSettings(input: unknown): Partial<Settings> {
  if (!input || typeof input !== 'object') return {};
  const out: Partial<Record<SettingKey, unknown>> = {};
  for (const key of SETTING_KEYS) {
    if (!(key in input)) continue;
    const v = sanitizeValue(key, (input as Record<string, unknown>)[key]);
    if (v !== undefined) out[key] = v;
  }
  return out as Partial<Settings>;
}

/** Only the entries that differ from the defaults, for compact share links. */
export function diffFromDefaults(settings: Settings): Partial<Settings> {
  const defaults = defaultSettings();
  const out: Partial<Record<SettingKey, unknown>> = {};
  for (const key of SETTING_KEYS) {
    if (settings[key] !== defaults[key]) out[key] = settings[key];
  }
  return out as Partial<Settings>;
}

/** The character ramp in use, ordered from lightest (index 0, usually a space) to densest. */
export function rampFor(settings: Pick<Settings, 'charset' | 'customChars'>): string[] {
  const source = settings.charset === 'custom' ? settings.customChars : CHARSETS[settings.charset].chars;
  const chars = [...source].filter((c) => c !== '\n' && c !== '\r' && c !== '\t');
  // Deduplicate while keeping order: repeated glyphs waste ramp levels.
  const unique = chars.filter((c, i) => chars.indexOf(c) === i);
  if (unique.length === 0) return [' ', '#'];
  if (unique.length === 1) return unique[0] === ' ' ? [' ', '#'] : [' ', unique[0]];
  return unique;
}
