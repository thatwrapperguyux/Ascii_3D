import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  buildEmbedPage,
  bytesToBase64,
  glbExtensions,
  glbIsPortable,
  iframeCode,
  type EmbedConfig,
} from '../src/export/embed';
import { buildZip, crc32 } from '../src/export/zip';

/** A minimal .glb: header, then a JSON chunk padded to four bytes. */
function glb(json: object): ArrayBuffer {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new DataView(new ArrayBuffer(20 + body.length));
  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, 20 + body.length, true);
  out.setUint32(12, body.length, true);
  out.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out.buffer, 20).set(body);
  return out.buffer;
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads a zip back: every local entry's name and uncompressed bytes, checked against its CRC. */
async function unzip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const files = new Map<string, Uint8Array>();
  const methods: number[] = [];
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const crc = view.getUint32(at + 14, true);
    const packed = view.getUint32(at + 18, true);
    const size = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + packed);
    const raw = method === 8 ? await inflateRaw(data.slice()) : data;
    methods.push(method);
    expect(raw.length).toBe(size);
    expect(crc32(raw)).toBe(crc);
    files.set(name, raw);
    at += 30 + nameLength + packed;
  }
  // Then the central directory and its end record, which points back at it.
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(files.size);
  expect(view.getUint32(end + 16, true)).toBe(at);
  // Text shrinks, so it is deflated; the check above proves it inflates back.
  expect(methods[0]).toBe(8);
  return files;
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes an archive that reads back byte for byte', async () => {
    const binary = new Uint8Array(4096).map((_, i) => (i * 7919) % 251);
    const page = '<!doctype html>' + '<p>ASCII</p>'.repeat(500);
    const files = await unzip(await buildZip([{ name: 'index.html', data: page }, { name: 'model.glb', data: binary }]));
    expect([...files.keys()]).toEqual(['index.html', 'model.glb']);
    expect(new TextDecoder().decode(files.get('index.html'))).toBe(page);
    expect(files.get('model.glb')).toEqual(binary);
  });
});

describe('glb inspection', () => {
  it('reads the declared extensions', () => {
    expect(glbExtensions(glb({ asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'] }))).toEqual([
      'EXT_meshopt_compression',
    ]);
    expect(glbExtensions(glb({ asset: { version: '2.0' } }))).toEqual([]);
  });

  it('only lets a model travel alone when it needs no separate decoder', () => {
    expect(glbIsPortable(glb({ asset: { version: '2.0' } }))).toBe(true);
    expect(glbIsPortable(glb({ asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'] }))).toBe(true);
    expect(glbIsPortable(glb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'] }))).toBe(false);
    expect(glbIsPortable(glb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_texture_basisu'] }))).toBe(false);
    expect(glbIsPortable(new TextEncoder().encode('{"asset":{}}').buffer)).toBe(false);
  });
});

describe('embed page', () => {
  it('round-trips base64', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  const config: EmbedConfig = {
    settings: { charset: 'custom', customChars: ' .</script><!--x' },
    model: { kind: 'data', name: 'Robot', base64: 'AAAA' },
    orbit: false,
  };
  const page = buildEmbedPage({
    code: { css: 'body{color:red}/* </style> */', js: 'const s = "</script>"; const c = "<!--";', fontLinks: ['<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=VT323">'] },
    shell: '<div class="app" id="app"></div>',
    config,
    title: 'Robot <in> ASCII',
    theme: 'dark',
    ground: '#0b0c0e',
  });

  it('never lets its content close the script or style early', () => {
    const scripts = page.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(2);
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    expect(page.match(/<\/style>/gi)).toHaveLength(1);
    expect(page).not.toContain('"</script>"');
    expect(page).toContain('<title>Robot &lt;in&gt; ASCII</title>');
  });

  it('carries the config so the page boots from it', () => {
    const json = /window\.ASCII3D_EMBED=(.*?);<\/script>/.exec(page)?.[1];
    expect(json).toBeDefined();
    expect(JSON.parse(json!)).toEqual(config);
    expect(page).toContain('class="embed"');
    expect(page).toContain('data-ui="dark"');
  });

  it('writes a responsive iframe in the chosen shape', () => {
    const code = iframeCode('https://robot.vercel.app/?a=1&b=2', '4/5', 'Robot "in" ASCII');
    expect(code).toBe(
      '<iframe src="https://robot.vercel.app/?a=1&amp;b=2" title="Robot &quot;in&quot; ASCII" style="width:100%;aspect-ratio:4/5;border:0;display:block" loading="lazy" allowfullscreen></iframe>',
    );
  });
});
