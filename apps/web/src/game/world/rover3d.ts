import type { Object3D } from 'three';
import {
  Box3,
  BufferGeometry,
  Group,
  Mesh,
  Quaternion,
  Euler,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * The Perseverance glTF, made to move: its single wheel mesh is split into the six wheels (by
 * triangle position), each on a steering pivot and a spin pivot, so they roll with the distance
 * driven, the four corner wheels steer (Ackermann, or the ~45° turn-in-place pose) and each wheel
 * follows the ground under it (a few centimetres of rocker-bogie travel). The robotic arm swings
 * down to core a sample and back.
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

const ARM_NODES = [
  'arm.001',
  'arm.002',
  'arm.003',
  'turret_obj',
  'cover_02',
  'PIXL_cover_01',
  'arm_cable_etc',
];

export class Rover3D {
  readonly root = new Group();
  /** Body (everything): placed on the terrain each frame. */
  private readonly body = new Group();
  readonly wheels: WheelState[] = [];
  private arm: Group | null = null;
  private armRest = new Quaternion();
  private turret: Object3D | null = null;
  private turretRest = new Vector3();
  private spinAngle = new Float32Array(6);
  private steerAngle = new Float32Array(6);
  /** Drill tip in the rover frame when the arm is down (m), for the dust puff. */
  readonly drillTip = new Vector3(0.35, 0.05, 1.75);

  static async load(url: string): Promise<Rover3D> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const rover = new Rover3D();
    rover.build(gltf.scene);
    return rover;
  }

  private build(model: Object3D): void {
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // A rover on Mars is dusty: no mirror-like surfaces (they also glint far beyond the HDR range).
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = m as { roughness?: number; envMapIntensity?: number };
        if (typeof std.roughness === 'number') std.roughness = Math.max(std.roughness, 0.32);
      }
    });
    this.body.add(model);
    this.root.add(this.body);
    model.updateMatrixWorld(true);
    this.splitWheels(model);
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
  }

  private buildArm(model: Object3D): void {
    const parts = ARM_NODES.map((n) => model.getObjectByName(n)).filter((o): o is Object3D => !!o);
    if (!parts.length) return;
    // Shoulder: the arm's rear end, on the front of the body.
    const box = new Box3();
    for (const p of parts) box.expandByObject(p);
    const shoulder = new Vector3((box.min.x + box.max.x) / 2, box.max.y - 0.12, box.min.z + 0.05);
    const arm = new Group();
    arm.position.copy(shoulder);
    this.body.add(arm);
    arm.updateMatrixWorld(true);
    for (const p of parts) arm.attach(p);
    this.arm = arm;
    this.armRest.copy(arm.quaternion);
    this.turret = model.getObjectByName('turret_obj') ?? null;
    if (this.turret) this.turretRest.copy(this.turret.position);
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
      w.spin.position.y = Math.max(-0.12, Math.min(0.12, lift[i] ?? 0)) / scale;
    }
  }

  /** Arm pose: 0 stowed (as modelled), 1 down on the ground in front; `drill` shakes the turret. */
  setArm(down: number, drill: number, timeS: number): void {
    if (!this.arm) return;
    const e = down * down * (3 - 2 * down);
    this.arm.quaternion.copy(this.armRest);
    this.arm.rotateX(e * 0.95);
    if (this.turret) {
      this.turret.position.copy(this.turretRest);
      if (drill > 0) {
        const j = 0.006 * drill;
        this.turret.position.x += Math.sin(timeS * 95) * j;
        this.turret.position.y += Math.abs(Math.sin(timeS * 47)) * j;
      }
    }
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
}
