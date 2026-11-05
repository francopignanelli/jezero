import type { Object3D } from 'three';
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Group,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type InterleavedBufferAttribute,
  type MeshStandardMaterial,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * The Perseverance glTF, made to move. The model is static, so its parts are cut out by triangle
 * position (rover frame: x left, y up, z forward) and hung on pivots:
 * - The six wheels: on a steering pivot and a spin pivot each. They roll with the distance driven,
 *   and the four corner wheels steer (Ackermann, or the ~45° turn-in-place pose). The model's
 *   "Wheels" mesh holds only the hubs: the tyres and spokes are cut out of the body mesh.
 * - The suspension legs: bend with the wheels, so the rocker-bogie follows the ground under each
 *   wheel.
 * - The mast head (Mastcam-Z, SuperCam): pans and tilts.
 * - The robotic arm: three joints (shoulder, elbow, wrist with the turret). For a core it unfolds,
 *   turns the turret to the drill, presses it to the ground, drills, and folds back.
 */

export interface WheelState {
  /** Wheel centre in the rover frame (m): x left, y up, z forward. */
  local: Vector3;
  side: 1 | -1; // +1 left, −1 right
  row: 0 | 1 | 2; // front, middle, rear
  steer: Group;
  spin: Group;
  radiusM: number;
}

/** Arm joint angles (rad) and the drill's percussion (0–1). 0 everywhere is the model's pose. */
export interface ArmPose {
  shoulder: number;
  elbow: number;
  wrist: number;
  drill: number;
}

/** The arm's nodes (three.js drops the dots of the glTF names, e.g. arm.001 → arm001). */
const ARM_NODES = [
  'arm001',
  'arm002',
  'arm003',
  'turret_obj',
  'cover_02',
  'PIXL_cover_01',
  'arm_cable_etc',
];
/** Mast head: above the column at the front right (from the model's geometry). */
const HEAD = { minY: 1.91, x: [-0.95, -0.15], z: [0.4, 1.0], pivot: new Vector3(-0.57, 1.95, 0.7) };
const TILT_ABOVE_PIVOT_M = 0.11;
/** Perseverance's wheels are 52.5 cm across. */
const TYRE_RADIUS_M = 0.2625;
/** Dust on the paint and on bare metal (multiplies the model's colours). */
const ROVER_DUST = new Color(0.6, 0.53, 0.45);
const ROVER_DUST_METAL = new Color(0.82, 0.76, 0.68);
const WHEEL_HOLDER = 'wheel-holder';
/** Wheel travel shown by the suspension (m). */
const MAX_LIFT_M = 0.18;
/** Shoulder angle while coring (boom lowered). */
export const CORE_SHOULDER = 0.3;

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();

/**
 * Moves the triangles of `mesh` whose centroid (in the rover frame, i.e. world space at build
 * time) `pick` assigns to a group into a new mesh under that group, keeping their placement.
 */
function carve(mesh: Mesh, pick: (centroid: Vector3) => Object3D | null): Mesh[] {
  const geo = mesh.geometry;
  const index = geo.getIndex();
  if (!index) return [];
  const pos = geo.getAttribute('position') as BufferAttribute | InterleavedBufferAttribute;
  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld;
  const keep: number[] = [];
  const parts = new Map<Object3D, number[]>();
  const c = new Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const i0 = index.getX(t);
    const i1 = index.getX(t + 1);
    const i2 = index.getX(t + 2);
    tmpA.fromBufferAttribute(pos, i0).applyMatrix4(m);
    tmpB.fromBufferAttribute(pos, i1).applyMatrix4(m);
    tmpC.fromBufferAttribute(pos, i2).applyMatrix4(m);
    c.copy(tmpA).add(tmpB).add(tmpC).divideScalar(3);
    const target = pick(c);
    const list = target ? (parts.get(target) ?? []) : keep;
    list.push(i0, i1, i2);
    if (target && !parts.has(target)) parts.set(target, list);
  }
  if (!parts.size) return [];
  geo.setIndex(keep);
  geo.computeBoundingSphere();
  if (!keep.length) mesh.visible = false;
  const out: Mesh[] = [];
  for (const [target, list] of parts) {
    const g = new BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
    g.setIndex(list);
    g.computeBoundingSphere();
    const part = new Mesh(g, mesh.material);
    part.castShadow = true;
    part.receiveShadow = true;
    part.name = `${mesh.name}-part`;
    mesh.parent!.add(part);
    part.position.copy(mesh.position);
    part.quaternion.copy(mesh.quaternion);
    part.scale.copy(mesh.scale);
    part.updateMatrixWorld(true);
    target.attach(part);
    out.push(part);
  }
  return out;
}

const underAny = (o: Object3D, names: string[]): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (names.includes(p.name)) return true;
  return false;
};

interface SuspensionMesh {
  attr: BufferAttribute;
  base: Float32Array;
  /** Rover-up in the mesh's local frame (with its scale). */
  up: Vector3;
  weight: Float32Array;
  side: Int8Array;
  z: Float32Array;
}

export class Rover3D {
  readonly root = new Group();
  /** Body (everything): placed on the terrain each frame. */
  private readonly body = new Group();
  readonly wheels: WheelState[] = [];
  private spinAngle = new Float32Array(6);
  private steerAngle = new Float32Array(6);
  private headPan: Group | null = null;
  private headTilt: Group | null = null;
  private shoulder: Group | null = null;
  private elbow: Group | null = null;
  private wrist: Group | null = null;
  private readonly wristRest = new Vector3();
  /** Drill tip in the wrist frame. */
  private readonly tipLocal = new Vector3();
  /** Elbow angle that puts the drill on the ground (rover's wheel plane), with CORE_SHOULDER. */
  coreElbow = 2.0;
  private readonly suspension: SuspensionMesh[] = [];
  private readonly lastLift = new Float32Array(6).fill(NaN);
  /** The turret's white LEDs (SHERLOC/WATSON lighting), lit while it works at the ground. */
  readonly led: Mesh;

  constructor() {
    this.led = new Mesh(
      new SphereGeometry(0.022, 10, 8),
      new MeshBasicMaterial({ color: 0xffffff }),
    );
    (this.led.material as MeshBasicMaterial).color.setScalar(9);
    this.led.visible = false;
  }

  static async load(url: string): Promise<Rover3D> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const rover = new Rover3D();
    rover.build(gltf.scene);
    return rover;
  }

  private build(model: Object3D): void {
    const dusted = new Set<unknown>();
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // A rover on Mars is dusty: no mirror-like surfaces (they also glint far beyond the HDR
      // range), and after hundreds of sols its white paint is a dusty tan (Mastcam-Z and WATSON
      // selfies). The model's paint textures are near pure white (albedo ~0.9), which no real
      // surface out there is: the body came out blown out and glowing.
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (dusted.has(m)) continue;
        dusted.add(m);
        const std = m as MeshStandardMaterial;
        if (typeof std.roughness !== 'number' || !std.color) continue;
        const metal = (std.metalness ?? 0) > 0.5;
        std.roughness = Math.max(std.roughness, metal ? 0.45 : 0.62);
        std.color.multiply(metal ? ROVER_DUST_METAL : ROVER_DUST);
      }
    });
    this.body.add(model);
    this.root.add(this.body);
    model.updateMatrixWorld(true);
    this.splitWheels(model);
    this.buildSuspension(model);
    this.buildHead(model);
    this.buildArm(model);
  }

  private splitWheels(model: Object3D): void {
    const node = model.getObjectByName('Wheels_objs');
    const mesh = (node &&
      ((node as Mesh).isMesh ? node : node.children.find((c) => (c as Mesh).isMesh))) as
      Mesh | undefined;
    if (!mesh) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as BufferAttribute | InterleavedBufferAttribute;
    const index = geo.getIndex();
    if (!index) return;
    const tri = index.count / 3;
    const cx = new Float32Array(tri);
    const cz = new Float32Array(tri);
    for (let t = 0; t < tri; t++) {
      let x = 0;
      let z = 0;
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t * 3 + k);
        x += pos.getX(v);
        z += pos.getZ(v);
      }
      cx[t] = x / 3;
      cz[t] = z / 3;
    }
    // Three rows along z (1-D k-means), two sides by the sign of x.
    let zs = [Math.min(...cz), 0, Math.max(...cz)];
    zs[1] = (zs[0]! + zs[2]!) / 2;
    const band = (z: number) => {
      let best = 0;
      for (let i = 1; i < 3; i++) if (Math.abs(z - zs[i]!) < Math.abs(z - zs[best]!)) best = i;
      return best;
    };
    for (let it = 0; it < 8; it++) {
      const sum = [0, 0, 0];
      const n = [0, 0, 0];
      for (let t = 0; t < tri; t++) {
        const b = band(cz[t]!);
        sum[b]! += cz[t]!;
        n[b]!++;
      }
      zs = zs.map((z, i) => (n[i] ? sum[i]! / n[i]! : z));
    }
    const groups = new Map<string, number[]>();
    for (let t = 0; t < tri; t++) {
      // glTF +Z is the rover's front: band 2 (largest z) is the front row.
      const row = 2 - band(cz[t]!);
      const key = `${cx[t]! > 0 ? 'L' : 'R'}${row}`;
      const list = groups.get(key) ?? [];
      list.push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
      groups.set(key, list);
    }
    const holder = new Group();
    holder.name = WHEEL_HOLDER;
    holder.position.copy(mesh.position);
    holder.quaternion.copy(mesh.quaternion);
    holder.scale.copy(mesh.scale);
    mesh.parent!.add(holder);
    mesh.parent!.remove(mesh);
    const toRover = new Vector3();
    for (const [key, list] of groups) {
      const g = new BufferGeometry();
      for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
      g.setIndex(list);
      const box = new Box3();
      for (const v of list) box.expandByPoint(new Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)));
      const centre = box.getCenter(new Vector3());
      const steer = new Group();
      steer.position.copy(centre);
      const spin = new Group();
      steer.add(spin);
      const wheel = new Mesh(g, mesh.material);
      wheel.position.copy(centre).negate();
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      spin.add(wheel);
      holder.add(steer);
      holder.updateMatrixWorld(true);
      steer.getWorldPosition(toRover);
      const size = box.getSize(new Vector3()).multiply(holder.getWorldScale(new Vector3()));
      this.wheels.push({
        local: toRover.clone(),
        side: key[0] === 'L' ? 1 : -1,
        row: Number(key[1]) as 0 | 1 | 2,
        steer,
        spin,
        radiusM: size.y / 2,
      });
    }
    this.wheels.sort((a, b) => a.row - b.row || b.side - a.side);
    // Tyres, spokes and hubs: body triangles inside each wheel's cylinder (radius ~0.27 m, from
    // 0.22 m inboard to 0.2 m outboard of the hub; further in are the fixed steering actuators).
    const meshes: Mesh[] = [];
    model.traverse((o) => {
      if (
        (o as Mesh).isMesh &&
        !underAny(o, [...ARM_NODES, 'suspension', 'Wheels_objs', WHEEL_HOLDER])
      )
        meshes.push(o as Mesh);
    });
    let moved = 0;
    for (const m of meshes)
      moved += carve(m, (c) => {
        for (const w of this.wheels) {
          const out = (c.x - w.local.x) * Math.sign(w.local.x);
          if (out < -0.22 || out > 0.2) continue;
          if (Math.hypot(c.y - w.local.y, c.z - w.local.z) < TYRE_RADIUS_M + 0.02) return w.spin;
        }
        return null;
      }).length;
    if (moved) for (const w of this.wheels) w.radiusM = TYRE_RADIUS_M;
  }

  /**
   * Suspension legs: every vertex moves up and down with the wheels on its side, interpolated
   * along the rover between the wheel rows. The wheel hubs move fully; vertices near the body
   * (the rocker pivots and the differential) do not move.
   */
  private buildSuspension(model: Object3D): void {
    const node = model.getObjectByName('suspension');
    if (!node || this.wheels.length !== 6) return;
    node.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.geometry.getAttribute('position');
      const n = src.count;
      const base = new Float32Array(n * 3);
      const weight = new Float32Array(n);
      const side = new Int8Array(n);
      const z = new Float32Array(n);
      mesh.updateMatrixWorld(true);
      const v = new Vector3();
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(src, i);
        base.set([v.x, v.y, v.z], i * 3);
        v.applyMatrix4(mesh.matrixWorld);
        const t = Math.min(1, Math.max(0, (1.25 - v.y) / 0.8));
        weight[i] = t * t * (3 - 2 * t);
        side[i] = v.x > 0 ? 1 : -1;
        z[i] = v.z;
      }
      const attr = new BufferAttribute(base.slice(), 3);
      mesh.geometry.setAttribute('position', attr);
      const inv = new Matrix3().setFromMatrix4(mesh.matrixWorld).invert();
      this.suspension.push({
        attr,
        base,
        up: new Vector3(0, 1, 0).applyMatrix3(inv),
        weight,
        side,
        z,
      });
    });
  }

  private buildHead(model: Object3D): void {
    const pan = new Group();
    pan.position.copy(HEAD.pivot);
    const tilt = new Group();
    tilt.position.set(0, TILT_ABOVE_PIVOT_M, 0);
    pan.add(tilt);
    this.body.add(pan);
    pan.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    model.traverse((o) => {
      if ((o as Mesh).isMesh && !underAny(o, [...ARM_NODES, 'Wheels_objs', 'suspension']))
        meshes.push(o as Mesh);
    });
    let moved = 0;
    for (const mesh of meshes)
      moved += carve(mesh, (c) =>
        c.y > HEAD.minY &&
        c.x > HEAD.x[0]! &&
        c.x < HEAD.x[1]! &&
        c.z > HEAD.z[0]! &&
        c.z < HEAD.z[1]!
          ? tilt
          : null,
      ).length;
    if (moved) {
      this.headPan = pan;
      this.headTilt = tilt;
    }
  }

  /**
   * Arm segments, from the model's pose (the boom forward at wheel-hub height, the forearm
   * standing at its end, the turret on top): the shoulder housing stays on the body; the boom
   * hangs on the shoulder, the forearm on the elbow, the turret on the wrist.
   */
  private buildArm(model: Object3D): void {
    const meshes: Mesh[] = [];
    model.traverse((o) => {
      if ((o as Mesh).isMesh && underAny(o, ARM_NODES)) meshes.push(o as Mesh);
    });
    if (!meshes.length) return;
    const shoulder = new Group();
    const elbow = new Group();
    const wrist = new Group();
    const turretBox = new Box3();
    const forearmBox = new Box3();
    const boomBox = new Box3();
    const classify = (c: Vector3) => {
      if (c.y > 1.6 && c.z > 1.5) return (turretBox.expandByPoint(c), wrist);
      if (c.z > 1.95) return (forearmBox.expandByPoint(c), elbow);
      if (c.z > 0.85) return (boomBox.expandByPoint(c), shoulder);
      return null;
    };
    // First pass for the pivots (bounds only).
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const index = geo.getIndex();
      if (!index) continue;
      const pos = geo.getAttribute('position');
      mesh.updateMatrixWorld(true);
      for (let t = 0; t < index.count; t += 3) {
        tmpA.fromBufferAttribute(pos, index.getX(t)).applyMatrix4(mesh.matrixWorld);
        tmpB.fromBufferAttribute(pos, index.getX(t + 1)).applyMatrix4(mesh.matrixWorld);
        tmpC.fromBufferAttribute(pos, index.getX(t + 2)).applyMatrix4(mesh.matrixWorld);
        classify(tmpA.add(tmpB).add(tmpC).divideScalar(3));
      }
    }
    if (boomBox.isEmpty() || forearmBox.isEmpty() || turretBox.isEmpty()) return;
    const S = new Vector3(
      (boomBox.min.x + boomBox.max.x) / 2,
      (boomBox.min.y + boomBox.max.y) / 2,
      boomBox.min.z,
    );
    const fc = forearmBox.getCenter(new Vector3());
    const E = new Vector3(fc.x, forearmBox.min.y + 0.05, fc.z);
    const W = new Vector3(fc.x, forearmBox.max.y, fc.z);
    shoulder.position.copy(S);
    this.body.add(shoulder);
    elbow.position.copy(E).sub(S);
    shoulder.add(elbow);
    wrist.position.copy(W).sub(E);
    elbow.add(wrist);
    this.body.updateMatrixWorld(true);
    for (const mesh of meshes) carve(mesh, classify);
    this.shoulder = shoulder;
    this.elbow = elbow;
    this.wrist = wrist;
    this.wristRest.copy(wrist.position);
    // Elbow angle that brings the turret down to the ground, and the drill tip (the turret drum's
    // lowest point there). Only the drum counts: cable triangles hang lower than it.
    const drum = wrist.children.filter((o) => o.name.startsWith('turret_obj'));
    const box = new Box3();
    const drumBox = () => {
      box.makeEmpty();
      for (const o of drum.length ? drum : [wrist]) box.expandByObject(o);
      return box;
    };
    // The first angle (unfolding forward) at which the turret touches the ground.
    let best = this.coreElbow;
    for (let a = 0.1; a <= 2.8; a += 0.01) {
      this.setArm({ shoulder: CORE_SHOULDER, elbow: a, wrist: Math.PI / 2, drill: 0 }, 0);
      this.root.updateMatrixWorld(true);
      drumBox();
      best = a;
      if (box.min.y <= 0.03) break;
    }
    this.coreElbow = best;
    this.setArm({ shoulder: CORE_SHOULDER, elbow: best, wrist: Math.PI / 2, drill: 0 }, 0);
    this.root.updateMatrixWorld(true);
    drumBox();
    const tip = new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    wrist.worldToLocal(this.tipLocal.copy(tip));
    wrist.add(this.led);
    this.led.position.copy(this.tipLocal).add(new Vector3(0, 0.12, 0));
    this.setArm({ shoulder: 0, elbow: 0, wrist: 0, drill: 0 }, 0);
  }

  /**
   * Poses the rover. `positionY` is the rover origin (wheel bottoms' plane) in world space,
   * heading clockwise from north, pitch nose-up, roll left-side-up.
   */
  setPose(
    x: number,
    y: number,
    z: number,
    headingRad: number,
    pitchRad: number,
    rollRad: number,
  ): void {
    this.root.position.set(x, y, z);
    this.root.quaternion.setFromEuler(new Euler(-pitchRad, Math.PI - headingRad, rollRad, 'YXZ'));
  }

  /**
   * Wheel animation: `distanceM` driven this frame (signed), `yawRate` (rad/s, clockwise), speed,
   * and per-wheel ground offsets (m, positive = ground higher than the body plane there).
   */
  animateWheels(
    distanceM: number,
    yawRate: number,
    speed: number,
    dt: number,
    lift: number[],
  ): void {
    const turningInPlace = Math.abs(speed) < 0.25 && Math.abs(yawRate) > 0.05;
    for (const [i, w] of this.wheels.entries()) {
      // Linear speed of this wheel: the body's plus the turn's (clockwise yaw moves left wheels forward).
      const v = distanceM + yawRate * dt * w.local.x;
      this.spinAngle[i]! += v / Math.max(0.1, w.radiusM);
      w.spin.rotation.x = this.spinAngle[i]!;
      let target = 0;
      if (w.row !== 1) {
        if (turningInPlace) {
          // Corner wheels tangent to a circle around the rover's centre.
          target = Math.atan2(w.local.z, w.local.x) - Math.PI / 2;
          target = Math.atan2(Math.sin(target), Math.cos(target));
          if (Math.abs(target) > Math.PI / 2) target -= Math.sign(target) * Math.PI;
        } else if (Math.abs(speed) > 0.05) {
          target = Math.atan((yawRate * w.local.z) / speed);
          target = Math.max(-0.6, Math.min(0.6, target));
        }
      }
      this.steerAngle[i]! += (target - this.steerAngle[i]!) * Math.min(1, dt * 6);
      w.steer.rotation.y = -this.steerAngle[i]!;
      const scale = w.steer.parent?.scale.y ?? 1;
      w.spin.position.y = Math.max(-MAX_LIFT_M, Math.min(MAX_LIFT_M, lift[i] ?? 0)) / scale;
    }
    this.bendSuspension(lift);
  }

  private bendSuspension(lift: number[]): void {
    if (!this.suspension.length) return;
    const l = lift.map((v) => Math.max(-MAX_LIFT_M, Math.min(MAX_LIFT_M, v)));
    let changed = false;
    for (let i = 0; i < 6; i++)
      if (!(Math.abs(l[i]! - this.lastLift[i]!) < 0.002)) {
        changed = true;
        this.lastLift[i] = l[i]!;
      }
    if (!changed) return;
    // Per side: wheel z and lift for the front, middle and rear rows.
    const rows = [1, -1].map((side) =>
      [0, 1, 2].map((row) => {
        const i = this.wheels.findIndex((w) => w.side === side && w.row === row);
        return { z: this.wheels[i]!.local.z, lift: l[i]! };
      }),
    );
    for (const s of this.suspension) {
      const a = s.attr.array as Float32Array;
      for (let i = 0; i < s.weight.length; i++) {
        const w = s.weight[i]!;
        const o = i * 3;
        if (w === 0) continue;
        const [f, m, r] = rows[s.side[i]! > 0 ? 0 : 1]!;
        const z = s.z[i]!;
        const d =
          z >= m!.z
            ? m!.lift + (f!.lift - m!.lift) * Math.min(1, (z - m!.z) / (f!.z - m!.z))
            : m!.lift + (r!.lift - m!.lift) * Math.min(1, (m!.z - z) / (m!.z - r!.z));
        a[o] = s.base[o]! + s.up.x * d * w;
        a[o + 1] = s.base[o + 1]! + s.up.y * d * w;
        a[o + 2] = s.base[o + 2]! + s.up.z * d * w;
      }
      s.attr.needsUpdate = true;
    }
  }

  /** Mast head: pan (rad, + left) and tilt (rad, + down). */
  setHead(pan: number, tilt: number): void {
    if (!this.headPan || !this.headTilt) return;
    this.headPan.rotation.y = pan;
    this.headTilt.rotation.x = tilt;
  }

  /** The front of the mast head (SuperCam's telescope) in world space. */
  headLensWorld(target: Vector3): Vector3 {
    if (!this.headTilt) return this.toWorld(tmpA.set(-0.57, 2.06, 0.85), target);
    this.headTilt.updateWorldMatrix(true, false);
    return this.headTilt.localToWorld(target.set(0, 0.02, 0.18));
  }

  /** The mast head's pivot in the rover frame (for aiming it). */
  get headPivot(): Vector3 {
    return HEAD.pivot;
  }

  /** Arm pose; `timeS` drives the percussion shake. */
  setArm(pose: ArmPose, timeS: number): void {
    if (!this.shoulder || !this.elbow || !this.wrist) return;
    this.shoulder.rotation.x = pose.shoulder;
    this.elbow.rotation.x = pose.elbow;
    this.wrist.rotation.y = pose.wrist;
    this.wrist.position.copy(this.wristRest);
    if (pose.drill > 0) {
      const j = 0.004 * pose.drill;
      this.wrist.position.x += Math.sin(timeS * 95) * j;
      this.wrist.position.z += Math.sin(timeS * 71 + 1) * j;
      this.wrist.position.y += Math.abs(Math.sin(timeS * 47)) * j;
    }
  }

  /** The drill tip in world space (follows the arm). */
  drillTipWorld(target: Vector3): Vector3 {
    if (!this.wrist) return this.toWorld(tmpA.set(0.3, 0.05, 2.6), target);
    this.wrist.updateWorldMatrix(true, false);
    return this.wrist.localToWorld(target.copy(this.tipLocal));
  }

  /** Wheel contact points in world space (for tracks, dust and suspension). */
  wheelWorld(i: number, target: Vector3): Vector3 {
    const w = this.wheels[i]!;
    return target
      .copy(w.local)
      .setY(0)
      .applyQuaternion(this.root.quaternion)
      .add(this.root.position);
  }

  /** A point given in the rover frame, in world space. */
  toWorld(local: Vector3, target: Vector3): Vector3 {
    return target.copy(local).applyQuaternion(this.root.quaternion).add(this.root.position);
  }

  /** A world point in the rover frame. */
  toLocal(world: Vector3, target: Vector3): Vector3 {
    return target
      .copy(world)
      .sub(this.root.position)
      .applyQuaternion(new Quaternion().copy(this.root.quaternion).invert());
  }
}
