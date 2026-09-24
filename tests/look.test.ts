import { describe, expect, it } from 'vitest';
import { THEME_GROUND, effectiveSettings, relativeLuminance } from '../src/state/look';
import { PRESETS, presetSettings } from '../src/state/presets';
import { defaultSettings } from '../src/state/schema';

describe('effectiveSettings', () => {
  it('takes ground, ink and accent from the theme when matching it', () => {
    const s = defaultSettings();
    for (const theme of ['light', 'dark'] as const) {
      const look = effectiveSettings(s, theme);
      expect(look.matchTheme).toBe(false);
      expect(look.colorMode).toBe('mono');
      expect(look.bg).toBe(THEME_GROUND[theme].bg);
      expect(look.fg).toBe(THEME_GROUND[theme].fg);
      expect(look.accent).toBe(THEME_GROUND[theme].accent);
    }
  });

  it('keeps the density mapping the same on both grounds', () => {
    const s = defaultSettings();
    expect(effectiveSettings(s, 'light').invert).toBe(false);
    expect(effectiveSettings(s, 'dark').invert).toBe(false);
    expect(effectiveSettings({ ...s, invert: true }, 'light').invert).toBe(true);
  });

  it('leaves a look with its own ground alone', () => {
    const scanner = presetSettings(PRESETS.find((p) => p.id === 'scanner')!);
    expect(effectiveSettings(scanner, 'light')).toEqual(scanner);
    expect(effectiveSettings(scanner, 'dark')).toEqual(scanner);
  });
});

describe('relativeLuminance', () => {
  it('spans black to white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });
});
