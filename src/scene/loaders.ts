import {
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  TextureLoader,
  type AnimationClip,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface LoadedModel {
  object: Object3D;
  clips: AnimationClip[];
  name: string;
  /** The file exactly as loaded, kept for single-file .glb models so an embed can carry it unchanged. */
  glb?: ArrayBuffer;
}

export type ProgressCallback = (fraction: number | null) => void;

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj', 'stl'] as const;
/** Everything the file picker accepts: models plus the side files a .gltf or .obj may reference. */
export const ACCEPTED_FILES = '.glb,.gltf,.fbx,.obj,.stl,.mtl,.bin,.png,.jpg,.jpeg,.webp,.ktx2';

export class ModelLoadError extends Error {}

export function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

function baseName(name: string): string {
  const file = name.split(/[?#]/)[0].split('/').pop() ?? name;
  return decodeURIComponent(file).replace(/\.[^.]+$/, '') || 'Model';
}

/** Downloads a URL as an ArrayBuffer. data: URIs are decoded locally (no network request). */
export async function fetchArrayBuffer(url: string, onProgress?: ProgressCallback): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = url.slice(5, comma);
    const payload = url.slice(comma + 1);
    if (meta.endsWith(';base64')) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(payload)).buffer as ArrayBuffer;
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new ModelLoadError(
      "Couldn't reach that URL. Check the address, and that the server allows cross-origin requests (CORS).",
    );
  }
  if (!response.ok) throw new ModelLoadError(`The server answered HTTP ${response.status} for that URL.`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total || !onProgress) return response.arrayBuffer();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

export class ModelLoader {
  private draco: DRACOLoader | null = null;
  private ktx2: KTX2Loader | null = null;

  constructor(private readonly renderer: WebGLRenderer) {}

  private gltfLoader(manager: LoadingManager): GLTFLoader {
    // Both loaders find their decoders relative to their own module (bundled by Vite).
    this.draco ??= new DRACOLoader();
    this.ktx2 ??= new KTX2Loader().detectSupport(this.renderer);
    const loader = new GLTFLoader(manager)
      .setDRACOLoader(this.draco)
      .setKTX2Loader(this.ktx2)
      .setMeshoptDecoder(MeshoptDecoder);
    if (__ARTIFACT__) {
      // The artifact sandbox may refuse fetch() of blob: URLs, which ImageBitmapLoader uses
      // for embedded textures; <img> decoding (TextureLoader) is allowed there.
      loader.register((parser) => {
        parser.textureLoader = new TextureLoader(parser.options.manager);
        return { name: 'artifact_image_decoding' };
      });
    }
    return loader;
  }

  private parseGltf(loader: GLTFLoader, data: ArrayBuffer | string, path: string): Promise<GLTF> {
    return new Promise((resolve, reject) => {
      loader.parse(data, path, resolve, (error) =>
        reject(new ModelLoadError(`This file couldn't be read as glTF: ${describe(error)}`)),
      );
    });
  }

  /** Loads from dropped or picked files. A .gltf/.obj may come with its .bin, .mtl and textures. */
  async fromFiles(files: File[]): Promise<LoadedModel> {
    const priority = ['glb', 'gltf', 'fbx', 'obj', 'stl'];
    const main = priority
      .map((ext) => files.find((f) => extensionOf(f.name) === ext))
      .find((f): f is File => f !== undefined);
    if (!main) {
      const names = files.map((f) => f.name).join(', ');
      throw new ModelLoadError(`No 3D model found in ${names || 'the selection'}. Use a .glb, .gltf, .fbx, .obj or .stl file.`);
    }

    // Resolve relative references (scene.bin, textures/wood.png) against the other selected files.
    const urls = new Map<string, string>();
    for (const file of files) {
      const url = URL.createObjectURL(file);
      urls.set(file.name.toLowerCase(), url);
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (relative) urls.set(relative.toLowerCase(), url);
    }
    const manager = new LoadingManager();
    manager.setURLModifier((url) => {
      if (/^(blob|data|https?):/i.test(url)) return url;
      const clean = decodeURIComponent(url).replace(/^(\.\/|\/)+/, '').toLowerCase();
      return urls.get(clean) ?? urls.get(clean.split('/').pop() ?? '') ?? url;
    });

    try {
      const ext = extensionOf(main.name);
      const name = baseName(main.name);
      switch (ext) {
        case 'glb': {
          const buffer = await main.arrayBuffer();
          return this.fromGltf(await this.parseGltf(this.gltfLoader(manager), buffer, ''), name, buffer);
        }
        case 'gltf':
          return this.fromGltf(await this.parseGltf(this.gltfLoader(manager), await main.text(), ''), name);
        case 'fbx':
          return await this.parseFbx(await main.arrayBuffer(), '', manager, name);
        case 'obj': {
          const mtl = files.find((f) => extensionOf(f.name) === 'mtl');
          return await this.parseObj(await main.text(), mtl ? await mtl.text() : null, manager, name);
        }
        default:
          return await this.parseStl(await main.arrayBuffer(), name);
      }
    } finally {
      // Give texture decoders a moment to finish before revoking.
      setTimeout(() => urls.forEach((url) => URL.revokeObjectURL(url)), 30_000);
    }
  }

  async fromUrl(url: string, onProgress?: ProgressCallback, displayName?: string): Promise<LoadedModel> {
    const ext = url.startsWith('data:') ? 'glb' : extensionOf(url) || 'glb';
    if (!(MODEL_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ModelLoadError(`".${ext}" isn't a supported model format. Use .glb, .gltf, .fbx, .obj or .stl.`);
    }
    const name = displayName ?? baseName(url);
    const path = url.startsWith('data:') ? '' : url.slice(0, url.split(/[?#]/)[0].lastIndexOf('/') + 1);
    const manager = new LoadingManager();
    const buffer = await fetchArrayBuffer(url, onProgress);
    const text = () => new TextDecoder().decode(buffer);

    switch (ext) {
      case 'glb':
        return this.fromGltf(await this.parseGltf(this.gltfLoader(manager), buffer, path), name, buffer);
      case 'gltf':
        return this.fromGltf(await this.parseGltf(this.gltfLoader(manager), text(), path), name);
      case 'fbx':
        return this.parseFbx(buffer, path, manager, name);
      case 'obj':
        return this.parseObj(text(), null, manager, name);
      default:
        return this.parseStl(buffer, name);
    }
  }

  /** Loads a .glb held in memory, such as the model carried inside a downloaded embed. */
  async fromBuffer(buffer: ArrayBuffer, name: string): Promise<LoadedModel> {
    return this.fromGltf(await this.parseGltf(this.gltfLoader(new LoadingManager()), buffer, ''), name, buffer);
  }

  private fromGltf(gltf: GLTF, name: string, glb?: ArrayBuffer): LoadedModel {
    const object = gltf.scene ?? gltf.scenes[0];
    if (!object) throw new ModelLoadError('The glTF file has no scene to show.');
    return { object, clips: gltf.animations ?? [], name, glb };
  }

  private async parseFbx(buffer: ArrayBuffer, path: string, manager: LoadingManager, name: string): Promise<LoadedModel> {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    try {
      const group = new FBXLoader(manager).parse(buffer, path);
      return { object: group, clips: group.animations ?? [], name };
    } catch (error) {
      throw new ModelLoadError(`This file couldn't be read as FBX: ${describe(error)}`);
    }
  }

  private async parseObj(text: string, mtlText: string | null, manager: LoadingManager, name: string): Promise<LoadedModel> {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const loader = new OBJLoader(manager);
    if (mtlText) {
      const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
      const materials = new MTLLoader(manager).parse(mtlText, '');
      materials.preload();
      loader.setMaterials(materials);
    }
    try {
      return { object: loader.parse(text), clips: [], name };
    } catch (error) {
      throw new ModelLoadError(`This file couldn't be read as OBJ: ${describe(error)}`);
    }
  }

  private async parseStl(buffer: ArrayBuffer, name: string): Promise<LoadedModel> {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    try {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      const material = new MeshStandardMaterial({
        color: 0xdddddd,
        roughness: 0.6,
        vertexColors: geometry.hasAttribute('color'),
      });
      return { object: new Mesh(geometry, material), clips: [], name };
    } catch (error) {
      throw new ModelLoadError(`This file couldn't be read as STL: ${describe(error)}`);
    }
  }

  dispose(): void {
    this.draco?.dispose();
    this.ktx2?.dispose();
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}
