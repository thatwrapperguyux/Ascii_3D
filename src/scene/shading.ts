import {
  BasicDepthPacking,
  DataTexture,
  DoubleSide,
  MeshDepthMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import type { Settings, Shading } from '../state/schema';

type MaterialSlot = Material | Material[];

/**
 * Swaps model materials for the selected shading style. Originals are kept so
 * "Original" restores them, and so they can be disposed with the model.
 */
export class ShadingLibrary {
  private readonly clay = new MeshStandardMaterial({ roughness: 0.62, metalness: 0, side: DoubleSide });
  private readonly wire = new MeshStandardMaterial({ roughness: 0.7, metalness: 0, wireframe: true, side: DoubleSide });
  private readonly toon: MeshToonMaterial;
  private readonly normal = new MeshNormalMaterial({ side: DoubleSide });
  private readonly depth = new MeshDepthMaterial({ depthPacking: BasicDepthPacking, side: DoubleSide });
  private readonly originals = new WeakMap<Mesh, MaterialSlot>();

  constructor() {
    const steps = new DataTexture(new Uint8Array([40, 110, 190, 255]), 4, 1, RedFormat);
    steps.minFilter = steps.magFilter = NearestFilter;
    steps.generateMipmaps = false;
    steps.needsUpdate = true;
    this.toon = new MeshToonMaterial({ gradientMap: steps, side: DoubleSide });
  }

  updateMaterials(s: Readonly<Pick<Settings, 'baseColor' | 'flatShading'>>): void {
    for (const material of [this.clay, this.wire, this.toon]) material.color.set(s.baseColor);
    for (const material of [this.clay, this.normal]) {
      if (material.flatShading !== s.flatShading) {
        material.flatShading = s.flatShading;
        material.needsUpdate = true;
      }
    }
  }

  private overrideFor(shading: Shading): Material | null {
    switch (shading) {
      case 'original':
        return null;
      case 'clay':
        return this.clay;
      case 'toon':
        return this.toon;
      case 'normal':
        return this.normal;
      case 'depth':
        return this.depth;
      case 'wireframe':
        return this.wire;
    }
  }

  apply(root: Object3D, shading: Shading): void {
    const override = this.overrideFor(shading);
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      if (!this.originals.has(mesh)) this.originals.set(mesh, mesh.material);
      const original = this.originals.get(mesh)!;
      if (!override) {
        mesh.material = original;
      } else {
        mesh.material = Array.isArray(original) ? original.map(() => override) : override;
      }
    });
  }

  /** Disposes the model's own materials and textures (never the shared overrides). */
  disposeModel(root: Object3D): void {
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh && !(object as { isPoints?: boolean }).isPoints && !(object as { isLine?: boolean }).isLine) {
        return;
      }
      mesh.geometry?.dispose();
      const slot = this.originals.get(mesh) ?? mesh.material;
      for (const material of Array.isArray(slot) ? slot : [slot]) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
            (value as { dispose(): void }).dispose();
          }
        }
        material.dispose();
      }
      this.originals.delete(mesh);
    });
  }
}
