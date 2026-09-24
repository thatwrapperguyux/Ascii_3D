import {
  BufferAttribute,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  TorusKnotGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const SAMPLES = [
  { id: 'fox', label: 'Fox', hint: 'Animated glTF: Survey, Walk and Run cycles' },
  { id: 'blob', label: 'Creature', hint: 'Organic shape that breathes and ripples' },
  { id: 'knot', label: 'Knot', hint: 'Torus knot' },
  { id: 'donut', label: 'Donut', hint: 'A nod to the classic donut.c' },
  { id: 'crystal', label: 'Crystal', hint: 'Faceted icosahedron' },
  { id: 'cube', label: 'Cube', hint: 'Rounded cube' },
] as const;

export type SampleId = (typeof SAMPLES)[number]['id'];
export type ProceduralId = Exclude<SampleId, 'fox'>;

export interface ProceduralSample {
  object: Object3D;
  name: string;
  /** Per-frame hook for animated samples. */
  update?: (time: number) => void;
}

const material = (color: number, roughness = 0.5) => new MeshStandardMaterial({ color, roughness, metalness: 0 });

export function isSampleId(value: string): value is SampleId {
  return SAMPLES.some((s) => s.id === value);
}

export function createProceduralSample(id: ProceduralId): ProceduralSample {
  switch (id) {
    case 'blob':
      return createBlob();
    case 'knot':
      return { object: new Mesh(new TorusKnotGeometry(0.72, 0.25, 320, 40), material(0xe2a76f, 0.45)), name: 'Knot' };
    case 'donut':
      return { object: new Mesh(new TorusGeometry(0.8, 0.36, 64, 160), material(0xf2b8c6, 0.4)), name: 'Donut' };
    case 'crystal': {
      // Non-indexed geometry, so computed normals are per face: a faceted look.
      const geometry = new IcosahedronGeometry(1, 1);
      geometry.computeVertexNormals();
      return { object: new Mesh(geometry, material(0xa8c7fa, 0.3)), name: 'Crystal' };
    }
    case 'cube':
      return { object: new Mesh(new RoundedBoxGeometry(1.4, 1.4, 1.4, 6, 0.2), material(0xd7d2c8, 0.55)), name: 'Cube' };
  }
}

/** A sphere displaced by a slowly moving field of sines: cheap and organic. */
function createBlob(): ProceduralSample {
  const geometry = mergeVertices(new IcosahedronGeometry(1, 28)) as BufferGeometry;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const base = Float32Array.from(position.array as Float32Array);
  const mesh = new Mesh(geometry, material(0x9fd8c9, 0.35));

  const update = (t: number) => {
    const array = position.array as Float32Array;
    for (let i = 0; i < array.length; i += 3) {
      const x = base[i];
      const y = base[i + 1];
      const z = base[i + 2];
      const d =
        Math.sin(x * 2.1 + t * 0.9) * Math.sin(y * 2.3 - t * 0.7) * Math.sin(z * 1.9 + t * 0.5) * 0.22 +
        Math.sin((x + y + z) * 3.1 + t * 1.3) * 0.06 +
        Math.sin(x * 4.3 - z * 3.7 - t * 0.8) * 0.035;
      const k = 1 + d;
      array[i] = x * k;
      array[i + 1] = y * k;
      array[i + 2] = z * k;
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  };
  update(0);
  return { object: mesh, name: 'Creature', update };
}
