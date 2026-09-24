import {
  AnimationMixer,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  LoopRepeat,
  MathUtils,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Light,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Settings, Shading } from '../state/schema';
import { ModelLoadError } from './loaders';
import type { SampleId } from './samples';
import { ShadingLibrary } from './shading';

export type ModelSource = { kind: 'sample'; id: SampleId } | { kind: 'url'; url: string } | { kind: 'file' };

export interface ModelInfo {
  name: string;
  source: ModelSource;
  meshes: number;
  triangles: number;
  vertices: number;
  clips: string[];
}

export interface PointerState {
  /** -1 (left) … 1 (right) */
  x: number;
  /** -1 (bottom) … 1 (top) */
  y: number;
  active: boolean;
}

const RIM_DIRECTION = new Vector3(-0.55, 0.45, -1).normalize();

export class Stage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(35, 1, 0.01, 100);
  readonly controls: OrbitControls;
  readonly shadingLibrary = new ShadingLibrary();
  info: ModelInfo | null = null;
  motionPaused = false;
  activeClip = -1;

  private readonly pivot = new Group();
  private readonly holder = new Group();
  private readonly key = new DirectionalLight(0xffffff, 2);
  private readonly rim = new DirectionalLight(0xffffff, 1);
  private readonly hemi = new HemisphereLight(0xffffff, 0x2a2d33, 0.35);
  private model: Object3D | null = null;
  private modelUpdate: ((time: number) => void) | null = null;
  private mixer: AnimationMixer | null = null;
  private actions: AnimationAction[] = [];
  private radius = 1;
  /** Starts at a three-quarter view: most models face +Z, and head-on hides their shape. */
  private spinAngle = 0.75;
  private motionTime = 0;
  private readonly follow = { x: 0, y: 0 };
  private readonly scratch = new Vector3();

  constructor(renderer: WebGLRenderer, domElement: HTMLElement) {
    this.scene.add(this.pivot);
    this.pivot.add(this.holder);
    this.scene.add(this.key, this.key.target, this.rim, this.rim.target, this.hemi);

    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.camera.position.set(0, 0.3, 5);
  }

  get hasModel(): boolean {
    return this.model !== null;
  }

  get clipCount(): number {
    return this.actions.length;
  }

  /** Current clip time and duration, for the telemetry readout. */
  clipProgress(): { name: string; time: number; duration: number } | null {
    const action = this.actions[this.activeClip];
    if (!action || !this.info) return null;
    const clip = action.getClip();
    return { name: this.info.clips[this.activeClip], time: action.time % (clip.duration || 1), duration: clip.duration };
  }

  setModel(
    object: Object3D,
    clips: AnimationClip[],
    name: string,
    source: ModelSource,
    update?: (time: number) => void,
  ): ModelInfo {
    object.updateMatrixWorld(true);
    const box = new Box3().setFromObject(object, true);
    if (box.isEmpty()) throw new ModelLoadError('The model loaded, but it has no visible geometry.');

    this.clearModel();

    // Center on the origin and scale so the longest side is 2 units.
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const scale = 2 / (Math.max(size.x, size.y, size.z) || 1);
    object.position.sub(center);
    const fit = new Group();
    fit.scale.setScalar(scale);
    fit.add(object);
    this.holder.add(fit);
    this.radius = box.getBoundingSphere(new Sphere()).radius * scale;

    let meshes = 0;
    let triangles = 0;
    let vertices = 0;
    object.traverse((child) => {
      // Lights exported with a model (often with extreme Blender intensities) would
      // override the Light controls; the tool's own rig lights everything instead.
      if ((child as Light).isLight) child.visible = false;
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      // Bones move vertices outside the bind-pose bounds; don't let culling pop them.
      if ((mesh as SkinnedMesh).isSkinnedMesh || update) mesh.frustumCulled = false;
      const position = mesh.geometry.getAttribute('position');
      if (!position) return;
      // glTF allows meshes without normals (GLTFLoader then shades them flat via derivatives).
      // The Clay/Toon/Normals overrides need real normals, or they compute NaN colors.
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      vertices += position.count;
      triangles += (mesh.geometry.index ? mesh.geometry.index.count : position.count) / 3;
    });

    if (clips.length) {
      this.mixer = new AnimationMixer(object);
      this.actions = clips.map((clip) => this.mixer!.clipAction(clip));
      const walk = clips.findIndex((clip) => /walk/i.test(clip.name));
      this.playClip(walk >= 0 ? walk : 0, 0);
    }

    this.model = object;
    this.modelUpdate = update ?? null;
    this.info = {
      name,
      source,
      meshes,
      triangles: Math.round(triangles),
      vertices,
      clips: clips.map((clip, i) => clip.name || `Clip ${i + 1}`),
    };
    this.resetView();
    return this.info;
  }

  private clearModel(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.model) this.mixer.uncacheRoot(this.model);
    }
    this.mixer = null;
    this.actions = [];
    this.activeClip = -1;
    if (this.model) this.shadingLibrary.disposeModel(this.model);
    this.holder.clear();
    this.model = null;
    this.modelUpdate = null;
    this.info = null;
  }

  playClip(index: number, fade = 0.35): void {
    const next = this.actions[index];
    if (!next) return;
    const previous = this.actions[this.activeClip];
    next.reset().setLoop(LoopRepeat, Infinity).play();
    if (previous && previous !== next) {
      if (fade > 0) previous.crossFadeTo(next, fade, false);
      else previous.stop();
    }
    this.activeClip = index;
  }

  setShading(shading: Shading): void {
    if (this.model) this.shadingLibrary.apply(this.model, shading);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Changes the field of view while keeping the model the same apparent size (a dolly zoom). */
  setFov(fov: number): void {
    const previous = this.camera.fov;
    if (previous === fov) return;
    const ratio = Math.tan(MathUtils.degToRad(previous) / 2) / Math.tan(MathUtils.degToRad(fov) / 2);
    this.scratch.subVectors(this.camera.position, this.controls.target).multiplyScalar(ratio);
    this.camera.position.copy(this.controls.target).add(this.scratch);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Frames the model from the front, slightly above. */
  resetView(): void {
    const fov = MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect);
    const fit = Math.min(fov, horizontal);
    const distance = this.radius / Math.sin(fit / 2);
    this.camera.position.set(0, 0.18, 1).normalize().multiplyScalar(distance);
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = this.radius * 0.6;
    this.controls.maxDistance = distance * 5;
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  update(dt: number, s: Readonly<Settings>, pointer: PointerState): void {
    const motionDt = this.motionPaused ? 0 : dt;
    this.motionTime += motionDt;
    this.mixer?.update(motionDt * s.animSpeed);
    this.modelUpdate?.(this.motionTime);
    this.spinAngle += MathUtils.degToRad(s.spin) * motionDt;

    // Ease toward the pointer so the model "notices" the cursor.
    const ease = 1 - Math.exp(-dt * 4);
    const targetX = pointer.active ? -pointer.y * 0.35 * s.follow : 0;
    const targetY = pointer.active ? pointer.x * 0.6 * s.follow : 0;
    this.follow.x += (targetX - this.follow.x) * ease;
    this.follow.y += (targetY - this.follow.y) * ease;
    this.pivot.rotation.set(
      this.follow.x,
      this.spinAngle + this.follow.y,
      Math.sin(this.motionTime * 0.7) * 0.04 * s.float,
    );
    this.pivot.position.y = Math.sin(this.motionTime * 1.1) * 0.08 * s.float * this.radius;

    // Lights are placed relative to the camera so shading reads the same from any angle.
    const azimuth = MathUtils.degToRad(s.lightAzimuth);
    const elevation = MathUtils.degToRad(s.lightElevation);
    this.scratch
      .set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation))
      .applyQuaternion(this.camera.quaternion);
    this.key.position.copy(this.scratch).multiplyScalar(10);
    this.rim.position.copy(RIM_DIRECTION).applyQuaternion(this.camera.quaternion).multiplyScalar(10);
    this.key.intensity = s.lightIntensity;
    this.rim.intensity = s.rim;
    this.hemi.intensity = s.ambient;
    this.scene.environmentIntensity = s.envIntensity;

    this.controls.update(dt);

    // Tight clip planes: better depth precision, and they define the range of the Depth shading.
    const distance = this.camera.position.distanceTo(this.pivot.position);
    const tight = s.shading === 'depth';
    const near = tight ? Math.max(0.01, distance - this.radius * 1.15) : Math.max(this.radius * 0.01, distance - this.radius * 4);
    const far = tight ? distance + this.radius * 1.15 : distance + this.radius * 8;
    if (near !== this.camera.near || far !== this.camera.far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }
}
