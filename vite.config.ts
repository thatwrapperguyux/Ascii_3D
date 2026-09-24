/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * `virtual:sample-models` resolves the bundled sample model URLs. The normal
 * build serves them from /public; the artifact build embeds them as data URIs
 * because the artifact sandbox cannot fetch arbitrary files.
 */
function sampleModels(inline: boolean): Plugin {
  const id = 'virtual:sample-models';
  const resolved = '\0' + id;
  return {
    name: 'sample-models',
    resolveId(source) {
      return source === id ? resolved : undefined;
    },
    load(loadId) {
      if (loadId !== resolved) return undefined;
      const fox = inline
        ? `data:model/gltf-binary;base64,${readFileSync(resolve(root, 'public/models/fox.glb')).toString('base64')}`
        : '/models/fox.glb';
      return `export const FOX_URL = ${JSON.stringify(fox)};`;
    },
  };
}

/**
 * Artifact build: inline the JS and CSS and emit an HTML *fragment* (no
 * doctype/html/head/body), which is the format claude.ai Artifacts expect.
 */
function artifactFragment(): Plugin {
  return {
    name: 'artifact-fragment',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlAsset = Object.values(bundle).find(
        (file) => file.type === 'asset' && file.fileName.endsWith('.html'),
      );
      if (!htmlAsset || htmlAsset.type !== 'asset') return;

      let html = String(htmlAsset.source);
      const scripts: string[] = [];
      const styles: string[] = [];

      for (const [key, file] of Object.entries(bundle)) {
        if (file.type === 'chunk') {
          // With code splitting off, Vite leaves its preload placeholder in the inlined
          // dynamic imports; `void 0` (no dependencies to preload) is what it would emit.
          const code = file.code.replace(/__VITE_PRELOAD__/g, 'void 0');
          scripts.push(code.replace(/<\/script/gi, '<\\/script'));
          delete bundle[key];
        } else if (file.fileName.endsWith('.css')) {
          styles.push(String(file.source));
          delete bundle[key];
        }
      }

      const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
      const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? '';
      const title = /<title>[\s\S]*?<\/title>/i.exec(head)?.[0] ?? '';
      const fontLinks = head.match(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/gi) ?? [];
      const cleanBody = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<link[^>]*>/gi, '');

      html = [
        title,
        ...fontLinks,
        `<style>${styles.join('\n')}</style>`,
        cleanBody.trim(),
        ...scripts.map((code) => `<script type="module">${code}</script>`),
      ].join('\n');

      htmlAsset.source = html;
    },
  };
}

export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    base: artifact ? './' : '/',
    publicDir: artifact ? false : 'public',
    define: {
      __ARTIFACT__: JSON.stringify(artifact),
    },
    plugins: [sampleModels(artifact), artifact ? artifactFragment() : null],
    build: {
      outDir: artifact ? 'dist-artifact' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
      // three's Draco/KTX2 loaders locate their decoders with `new URL(…, import.meta.url)`,
      // so Vite emits them as assets. The artifact build keeps them next to the page
      // (assetsDir '') because its JS is inlined into index.html.
      assetsDir: artifact ? '' : 'assets',
      cssCodeSplit: !artifact,
      rolldownOptions: artifact ? { output: { codeSplitting: false } } : undefined,
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
