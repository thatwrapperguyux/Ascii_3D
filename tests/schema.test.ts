import { describe, expect, it } from 'vitest';
import { PRESETS, presetSettings, randomLook } from '../src/state/presets';
import {
  SCHEMA,
  SETTING_KEYS,
  defaultSettings,
  diffFromDefaults,
  rampFor,
  sanitizeSettings,
  sanitizeValue,
} from '../src/state/schema';
import { decodeSettings, encodeSettings } from '../src/state/share';

describe('sanitizeValue', () => {
  it('clamps numbers into range and parses numeric strings', () => {
    expect(sanitizeValue('cellSize', 999)).toBe(SCHEMA.cellSize.max);
    expect(sanitizeValue('cellSize', -5)).toBe(SCHEMA.cellSize.min);
    expect(sanitizeValue('contrast', '1.5')).toBe(1.5);
    expect(sanitizeValue('contrast', 'abc')).toBeUndefined();
    expect(sanitizeValue('contrast', Number.NaN)).toBeUndefined();
  });

  it('accepts only known enum values', () => {
    expect(sanitizeValue('charset', 'blocks')).toBe('blocks');
    expect(sanitizeValue('charset', 'nope')).toBeUndefined();
  });

  it('normalizes colors and rejects invalid ones', () => {
    expect(sanitizeValue('bg', '#ABCDEF')).toBe('#abcdef');
    expect(sanitizeValue('bg', '#abc')).toBe('#aabbcc');
    expect(sanitizeValue('bg', 'red')).toBeUndefined();
    expect(sanitizeValue('bg', '#12345g')).toBeUndefined();
  });

  it('requires real booleans and truncates long text', () => {
    expect(sanitizeValue('scan', 'true')).toBeUndefined();
    expect(sanitizeValue('scan', false)).toBe(false);
    expect(sanitizeValue('customChars', 'x'.repeat(500))).toHaveLength(SCHEMA.customChars.maxLength);
  });
});

describe('sanitizeSettings', () => {
  it('drops unknown keys and invalid values', () => {
    const out = sanitizeSettings({ cellSize: 12, bogus: 1, bg: 'nope', invert: true });
    expect(out).toEqual({ cellSize: 12, invert: true });
  });

  it('handles non-objects', () => {
    expect(sanitizeSettings(null)).toEqual({});
    expect(sanitizeSettings('x')).toEqual({});
  });
});

describe('defaults and presets', () => {
  it('every default is valid under its own schema', () => {
    const defaults = defaultSettings();
    for (const key of SETTING_KEYS) expect(sanitizeValue(key, defaults[key])).toBe(defaults[key]);
  });

  it('every preset only uses valid values', () => {
    for (const preset of PRESETS) {
      expect(sanitizeSettings(preset.settings)).toEqual(preset.settings);
      expect(Object.keys(presetSettings(preset))).toHaveLength(SETTING_KEYS.length);
    }
  });

  it('preset ids are unique and fit the 1–9 shortcuts', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(PRESETS.length).toBeLessThanOrEqual(9);
  });

  it('randomLook always produces valid settings and keeps motion', () => {
    const current = { ...defaultSettings(), spin: -33 };
    for (let i = 0; i < 200; i++) {
      const look = randomLook(current);
      expect(sanitizeSettings(look)).toEqual(look);
      expect(look.spin).toBe(-33);
    }
  });

  it('diffFromDefaults keeps only changed keys', () => {
    expect(diffFromDefaults(defaultSettings())).toEqual({});
    expect(diffFromDefaults({ ...defaultSettings(), invert: true })).toEqual({ invert: true });
  });
});

describe('rampFor', () => {
  it('uses the preset ramp, light to dense', () => {
    expect(rampFor({ charset: 'standard', customChars: '' })).toEqual([...' .:-=+*#%@']);
  });

  it('dedupes custom characters and strips control characters', () => {
    expect(rampFor({ charset: 'custom', customChars: ' ..oO\n@@' })).toEqual([' ', '.', 'o', 'O', '@']);
  });

  it('always yields at least two levels', () => {
    expect(rampFor({ charset: 'custom', customChars: '' })).toEqual([' ', '#']);
    expect(rampFor({ charset: 'custom', customChars: 'x' })).toEqual([' ', 'x']);
    expect(rampFor({ charset: 'custom', customChars: ' ' })).toEqual([' ', '#']);
  });

  it('keeps multi-byte glyphs intact', () => {
    expect(rampFor({ charset: 'dots', customChars: '' })).toHaveLength(9);
  });
});

describe('share encoding', () => {
  it('round-trips settings, including unicode glyphs', () => {
    const settings = { charset: 'custom' as const, customChars: ' ·░▒▓█⣿', cellSize: 14, invert: true };
    const encoded = encodeSettings(settings);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSettings(encoded)).toEqual(settings);
  });

  it('returns an empty object for garbage', () => {
    expect(decodeSettings('%%%')).toEqual({});
    expect(decodeSettings(encodeSettings({ cellSize: 'huge' } as never))).toEqual({});
  });
});
