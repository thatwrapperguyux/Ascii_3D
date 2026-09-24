import './styles.css';
import { App, type AppDom } from './app';
import { PRESETS, presetSettings } from './state/presets';
import { defaultSettings, type Settings } from './state/schema';
import { decodeSettings, loadStoredSettings } from './state/share';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/**
 * URL options (the deployed site; the Artifact sandbox never sees the query string):
 *   ?model=/models/robot.glb | https://… | sample:fox   model to open
 *   ?preset=phosphor                                     start from a built-in look
 *   ?embed=1                                             no interface, for <iframe> embeds
 *   ?controls=0                                          disable orbit/zoom (e.g. page backgrounds)
 *   #s=…                                                 settings from "Copy link" / "Embed code"
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
const embed = !__ARTIFACT__ && params.has('embed') && params.get('embed') !== '0';

const dom: AppDom = {
  app: byId('app'),
  stage: byId('stage'),
  viewport: byId('viewport'),
  frame: byId('frame'),
  canvas: byId<HTMLCanvasElement>('view'),
  inspector: byId('inspector'),
  modelName: byId('model-name'),
  telemetry: byId('telemetry'),
  hint: byId('hint'),
  dropzone: byId('dropzone'),
  loading: byId('loading'),
  loadingLabel: byId('loading-label'),
  loadingBar: byId('loading-bar'),
  toasts: byId('toasts'),
  fileInput: byId<HTMLInputElement>('file-input'),
  uploadButton: byId<HTMLButtonElement>('act-upload'),
  snapshotButton: byId<HTMLButtonElement>('act-snapshot'),
  recordButton: byId<HTMLButtonElement>('act-record'),
  recordTime: byId('rec-time'),
  fullscreenButton: byId<HTMLButtonElement>('act-fullscreen'),
  hideButton: byId<HTMLButtonElement>('act-hide'),
  panelButton: byId<HTMLButtonElement>('act-panel'),
};

try {
  const app = new App(dom, initialSettings(params, embed), {
    embed,
    orbit: params.get('controls') !== '0',
    persist: !embed,
    networkFeatures: !__ARTIFACT__,
  });
  void app.start(params.get('model'));
} catch (error) {
  console.error(error);
  byId('fatal').hidden = false;
}
