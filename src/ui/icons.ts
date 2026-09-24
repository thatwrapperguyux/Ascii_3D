/**
 * Interface icons on a 24-unit grid at a 1.5 stroke. Where one existed, the
 * icon is Iconoir's (iconoir.com, MIT), as used by Grids Studio; the rest are
 * drawn to the same grid and weight so they sit on the same hairline.
 */
const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"';

export const ICONS = {
  // Iconoir
  type: `<path ${S} d="M19 7V5H5v2m7-2v14m0 0h-2m2 0h2"/>`,
  export: `<path ${S} d="M6 20h12M12 4v12m0 0l3.5-3.5M12 16l-3.5-3.5"/>`,
  sheet: `<path ${S} stroke-miterlimit="1.5" d="M4.998 2H2v2.998h2.998zm0 1.501h14M3.499 4.998V19M20.497 5v14.002M4.998 20.501h14M4.998 19H2v2.998h2.998zM21.996 2.002h-2.998V5h2.998zm0 17h-2.998V22h2.998z"/>`,
  sparkles: `<path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="M8 15c4.875 0 7-2.051 7-7c0 4.949 2.11 7 7 7c-4.89 0-7 2.11-7 7c0-4.89-2.125-7-7-7ZM2 6.5c3.134 0 4.5-1.318 4.5-4.5c0 3.182 1.357 4.5 4.5 4.5c-3.143 0-4.5 1.357-4.5 4.5c0-3.143-1.366-4.5-4.5-4.5Z"/>`,
  shuffle: `<path ${S} d="M16 3h5v5M4 20L21 3m0 13v5h-5m5 0l-6-6M4 4l5 5"/>`,
  undo: `<g ${S}><path d="M4.5 8H15s5 0 5 4.706C20 18 15 18 15 18H6.286"/><path d="M7.5 11.5L4 8l3.5-3.5"/></g>`,
  zone: `<path ${S} d="M7 4H4v3m0 4v2m7-9h2m-2 16h2m7-9v2m-3-9h3v3M7 20H4v-3m13 3h3v-3"/>`,
  // Drawn to match
  cube: `<g ${S}><path d="M12 2.8 20.2 7.3v9.4L12 21.2 3.8 16.7V7.3z"/><path d="M3.8 7.3 12 11.8l8.2-4.5M12 11.8v9.4"/></g>`,
  looks: `<g ${S}><circle cx="9" cy="9.2" r="5.2"/><circle cx="15" cy="9.2" r="5.2"/><circle cx="12" cy="14.8" r="5.2"/></g>`,
  contrast: `<g ${S}><circle cx="12" cy="12" r="8.6"/><path d="M12 3.4v17.2"/></g><path fill="currentColor" d="M12 3.4a8.6 8.6 0 0 1 0 17.2z"/>`,
  droplet: `<path ${S} d="M12 3.2s6.2 6.6 6.2 10.9a6.2 6.2 0 0 1-12.4 0C5.8 9.8 12 3.2 12 3.2z"/>`,
  sun: `<g ${S}><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M2.8 12h2M19.2 12h2M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/></g>`,
  orbit: `<g ${S}><ellipse cx="12" cy="12" rx="9.2" ry="4.2"/><circle cx="12" cy="12" r="2.2"/><path d="M17.6 6.2l1.6 1.9-2.4.9"/></g>`,
  code: `<path ${S} d="M13.5 6 10 18.5M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5"/>`,
  video: `<g ${S}><rect x="2.8" y="6.2" width="12.6" height="11.6" rx="2.2"/><path d="m15.4 10.6 5.8-3.2v9.2l-5.8-3.2"/></g>`,
  stop: `<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>`,
  upload: `<path ${S} d="M6 20h12M12 16V4m0 0 3.5 3.5M12 4 8.5 7.5"/>`,
  copy: `<g ${S}><rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V5.7a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8"/></g>`,
  link: `<g ${S}><path d="M10.2 13.8a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66l-1.1 1.1"/><path d="M13.8 10.2a4 4 0 0 0-5.66 0L5.31 13.03a4 4 0 0 0 5.66 5.66l1.1-1.1"/></g>`,
  play: `<path fill="currentColor" d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z"/>`,
  pause: `<path ${S} d="M8 5v14M16 5v14"/>`,
  target: `<g ${S}><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></g>`,
  file: `<g ${S}><path d="M6 2.8h8.2l4 4v14.4H6z"/><path d="M14 2.8v4.2h4.2"/></g>`,
  eye: `<g ${S}><path d="M2.5 12S5.9 5.8 12 5.8 21.5 12 21.5 12 18.1 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></g>`,
  expand: `<path ${S} d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`,
  // The theme switch and the sound toggle, exactly as Grids Studio draws them
  light: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.3M12 19.3v2.3M4.22 4.22l1.63 1.63M18.15 18.15l1.63 1.63M2.4 12h2.3M19.3 12h2.3M4.22 19.78l1.63-1.63M18.15 5.85l1.63-1.63"/></g>`,
  dark: `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8z"/>`,
  sound: `<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="wave1" d="M16.5 9.2a4 4 0 0 1 0 5.6"/><path class="wave2" d="M19 6.7a7.5 7.5 0 0 1 0 10.6"/><path class="mute" d="M17 9.5l5 5m0-5l-5 5" style="display:none"/></g>`,
} as const;

export type IconName = keyof typeof ICONS;

export function iconMarkup(name: IconName): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** The app mark: an isometric cube in three ink values, so it turns over with the theme. */
export const LOGO_MARK = `<svg class="logo-mark" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 2.2 20.8 7 12 11.8 3.2 7z" fill="currentColor"/>
  <path d="M3.2 7 12 11.8v10L3.2 17z" fill="currentColor" opacity=".55"/>
  <path d="M20.8 7 12 11.8v10l8.8-4.8z" fill="currentColor" opacity=".25"/>
</svg>`;
