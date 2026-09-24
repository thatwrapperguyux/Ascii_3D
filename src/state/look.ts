import type { Settings } from './schema';

export type UiTheme = 'light' | 'dark';

/** The Mono ground in each interface theme, sampled from the interface's own ink. */
export const THEME_GROUND: Record<UiTheme, { bg: string; fg: string; accent: string }> = {
  light: { bg: '#ffffff', fg: '#18181b', accent: '#71717a' },
  dark: { bg: '#09090b', fg: '#ecedee', accent: '#a1a1aa' },
};

/**
 * The settings the renderer actually uses. With matchTheme on, the look takes
 * its ground, glyph colour and accent from the interface theme: ink on white
 * in light mode, white on near-black in dark mode. Density is left alone, so
 * the lit model prints as the dense figure on either ground.
 */
export function effectiveSettings(settings: Readonly<Settings>, theme: UiTheme): Settings {
  if (!settings.matchTheme) return { ...settings };
  const ground = THEME_GROUND[theme];
  return {
    ...settings,
    matchTheme: false,
    colorMode: 'mono',
    bg: ground.bg,
    fg: ground.fg,
    accent: ground.accent,
  };
}

/** WCAG relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
