import './styles.css';
import { App, type AppDom } from './app';
import { captureShell } from './export/embed';
import { PRESETS, presetSettings } from './state/presets';
import { defaultSettings, sanitizeSettings, type Settings } from './state/schema';
import { decodeSettings, loadStoredSettings, readPref } from './state/share';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

// Taken before the app fills the page in: an embed download is built from it.
const shell = captureShell();

/**
 * URL options (the deployed site; the Artifact sandbox never sees the query string):
 *   ?model=/models/robot.glb | https://… | sample:fox   model to open
 *   ?preset=phosphor                                     start from a built-in look
 *   ?embed=1                                             no interface, for <iframe> embeds
 *   ?controls=0                                          disable orbit/zoom (e.g. page backgrounds)
 *   ?clip=2                                              animation clip to play
 *   #s=…                                                 settings from "Copy link" / "Copy embed code"
 *
 * A downloaded embed page instead carries everything in `window.ASCII3D_EMBED`.
 */
function initialSettings(params: URLSearchParams, embed: boolean): Settings {
  const shared = new URLSearchParams(location.hash.slice(1)).get('s');
  const preset = PRESETS.find((p) => p.id === params.get('preset'));
  let settings = preset ? presetSettings(preset) : defaultSettings();
  if (!preset && !shared && !embed) settings = { ...settings, ...loadStoredSettings() };
  if (shared) settings = { ...settings, ...decodeSettings(shared) };
  return settings;
}

const params = new URLSearchParams(location.search);
const packed = window.ASCII3D_EMBED;
const embed = !!packed || (!__ARTIFACT__ && params.has('embed') && params.get('embed') !== '0');
if (embed) document.documentElement.classList.add('embed');
// index.html sets the theme before first paint; the Artifact build has no head script to do it,
// but its viewer marks an explicit light or dark choice as data-theme.
if (!document.documentElement.dataset.ui) {
  const choice = readPref('ui') ?? document.documentElement.dataset.theme;
  document.documentElement.dataset.ui =
    choice === 'dark' || choice === 'light' ? choice : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const dom: AppDom = {
  app: byId('app'),
  stage: byId('stage'),
  viewport: byId('viewport'),
  canvas: byId<HTMLCanvasElement>('view'),
  railLeft: byId('rail-left'),
  railRight: byId('rail-right'),
  stagebar: byId('stagebar'),
  framemarks: byId('framemarks'),
  telemetry: byId('telemetry'),
  themeSwitch: byId('seg-ui'),
  hideButton: byId<HTMLButtonElement>('act-hide'),
  fullscreenButton: byId<HTMLButtonElement>('act-fullscreen'),
  soundButton: byId<HTMLButtonElement>('btn-sound'),
  cta: byId('cta'),
  randomButton: byId<HTMLButtonElement>('btn-random'),
  recordButton: byId<HTMLButtonElement>('btn-record'),
  recordTitle: byId('rec-title'),
  recordSub: byId('rec-sub'),
  loading: byId('loading'),
  loadingLabel: byId('loading-label'),
  loadingBar: byId('loading-bar'),
  dropzone: byId('dropzone'),
  toast: byId('toast'),
  fileInput: byId<HTMLInputElement>('file-input'),
  mob: byId('mob'),
  mobSheet: byId('mob-sheet'),
  mobCopy: byId<HTMLButtonElement>('mob-copy'),
  mobOpen: byId<HTMLButtonElement>('mob-open'),
};

try {
  const settings = packed ? { ...defaultSettings(), ...sanitizeSettings(packed.settings) } : initialSettings(params, embed);
  const app = new App(dom, settings, {
    embed,
    orbit: packed ? packed.orbit !== false : params.get('controls') !== '0',
    persist: !embed,
    networkFeatures: !__ARTIFACT__ && !packed,
    shell,
  });
  const clip = packed ? (packed.clip ?? -1) : Number(params.get('clip') ?? -1);
  void app.start(packed ? packed.model : params.get('model'), Number.isInteger(clip) ? clip : -1);
} catch (error) {
  console.error(error);
  byId('fatal').hidden = false;
}
