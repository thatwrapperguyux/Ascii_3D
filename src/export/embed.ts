/**
 * Embeds. A model someone uploaded exists only in their browser, so an iframe
 * on another site has nothing to load. The fix is to package it: one page
 * that carries this app's own code, the model and the look, which any static
 * host can serve and any site can then show in an iframe.
 */
import type { SampleId } from '../scene/samples';
import type { UiTheme } from '../state/look';
import type { Settings } from '../state/schema';

export type EmbedModel =
  | { kind: 'sample'; id: SampleId }
  /** Relative to the embed page, e.g. the model.glb that sits next to it in the zip. */
  | { kind: 'url'; url: string; name: string }
  | { kind: 'data'; name: string; base64: string };

/** What an embed page boots from: `window.ASCII3D_EMBED`, written into the page. */
export interface EmbedConfig {
  settings: Partial<Settings>;
  model: EmbedModel;
  /** Drag to orbit and scroll to zoom. */
  orbit: boolean;
  /** The animation clip to play, if the model has several. */
  clip?: number;
}

/** The app's own stylesheet and script, and the font links its glyphs need. */
export interface AppCode {
  css: string;
  js: string;
  fontLinks: string[];
}

const SHELL_IDS = ['app', 'dropzone', 'fatal', 'toast', 'file-input'];

/** The page's markup as it is before the app fills it in; call before anything changes the DOM. */
export function captureShell(): string {
  return SHELL_IDS.map((id) => document.getElementById(id)?.outerHTML ?? '').join('\n');
}

/**
 * Reads the running app's code back out of the page: inline in the Artifact
 * build, or fetched from the same origin in the normal build.
 */
export async function collectAppCode(): Promise<AppCode> {
  const fontLinks = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]')].map(
    (link) => `<link rel="stylesheet" href="${escapeAttr(link.href)}">`,
  );
  const inlineJs = document.getElementById('ascii3d-js');
  const inlineCss = document.getElementById('ascii3d-css');
  if (inlineJs?.textContent && inlineCss) {
    return { js: inlineJs.textContent, css: inlineCss.textContent ?? '', fontLinks };
  }

  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  if (!script) throw new Error("This page's code couldn't be found, so the embed can't be built here.");
  const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter(
    (link) => !link.href.includes('fonts.googleapis.com'),
  );
  const text = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't read ${url} (HTTP ${response.status}).`);
    return response.text();
  };
  const [js, ...css] = await Promise.all([text(script.src), ...sheets.map((link) => text(link.href))]);
  return { js, css: css.join('\n'), fontLinks };
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

/** The glTF extensions a .glb declares, read from its JSON chunk without parsing the rest. */
export function glbExtensions(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) {
    throw new Error('Not a binary glTF file.');
  }
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length))) as { extensionsUsed?: unknown };
  return Array.isArray(json.extensionsUsed) ? json.extensionsUsed.filter((e): e is string => typeof e === 'string') : [];
}

/**
 * Draco geometry and Basis textures are decoded by separate WebAssembly files
 * that an embed page doesn't carry; such a model is written out afresh instead.
 * (Meshopt's decoder is part of the app's own script, so it travels.)
 */
export function glbIsPortable(buffer: ArrayBuffer): boolean {
  try {
    const extensions = glbExtensions(buffer);
    return !extensions.includes('KHR_draco_mesh_compression') && !extensions.includes('KHR_texture_basisu');
  } catch {
    return false;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Keeps code from ending its own <script>/<style> element early. */
const inlineScript = (code: string) => code.replace(/<(\/script|!--)/gi, '\\x3C$1');
const inlineStyle = (css: string) => css.replace(/<\/style/gi, '\\3C/style');

export interface EmbedPageParts {
  code: AppCode;
  shell: string;
  config: EmbedConfig;
  title: string;
  /** The interface theme that matches the look's ground, for the few overlays an embed can show. */
  theme: UiTheme;
  /** The page colour behind the render, or 'transparent'. */
  ground: string;
}

/** One HTML file that shows the render full-bleed and nothing else. */
export function buildEmbedPage(p: EmbedPageParts): string {
  const config = JSON.stringify(p.config).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en" data-ui="${p.theme}" class="embed">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<link rel="icon" href="data:,">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${p.code.fontLinks.join('\n')}
<style>${inlineStyle(p.code.css)}</style>
</head>
<body style="background:${escapeAttr(p.ground)}">
${p.shell}
<script>window.ASCII3D_EMBED=${config};</script>
<script type="module">${inlineScript(p.code.js)}</script>
</body>
</html>
`;
}

/** The snippet a site pastes in: responsive width, a fixed shape, no border. */
export function iframeCode(src: string, shape: string, title: string): string {
  return `<iframe src="${escapeAttr(src)}" title="${escapeAttr(title)}" style="width:100%;aspect-ratio:${shape};border:0;display:block" loading="lazy" allowfullscreen></iframe>`;
}
