import { Vector3, type PerspectiveCamera } from 'three';
import { follow, wrapAngle } from '../../lib/math';

export type CameraMode = 'chase' | 'far' | 'top';

/** Distance behind the rover (m) and elevation angle (°) per mode. */
const MODES: Record<CameraMode, { distM: number; elevDeg: number }> = {
  chase: { distM: 8.5, elevDeg: 16 },
  far: { distM: 18, elevDeg: 24 },
  top: { distM: 70, elevDeg: 68 },
};
const AIM_UP_M = 1.3;
const CLEARANCE_M = 1.1;

export interface RigInput {
  /** Rover origin (world) and heading (clockwise from north). */
  at: Vector3;
  headingRad: number;
  speed: number;
  /** 0–1: shake from rough ground. */
  rough: number;
  /** Close-up on the arm while coring (0–1), and the drill point (world). */
  coring: number;
  drill: Vector3;
  ground(x: number, z: number): number;
}

/**
 * Chase camera: follows the rover's heading with smoothing, keeps clear of the ground, can be
 * dragged round and zoomed, shakes a little on rough ground, swings to a close-up of the arm
 * while coring, and descends from high above at a mission start.
 */
export class CameraRig {
  mode: CameraMode = 'chase';
  private heading = 0;
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private readonly wantPos = new Vector3();
  private readonly wantLook = new Vector3();
  private yawOffset = 0;
  private elevOffset = 0;
  private zoom = 1;
  private dragging = false;
  private intro = 0;
  private time = 0;
  private snapped = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    canvas: HTMLCanvasElement,
  ) {
    canvas.style.touchAction = 'none';
    let last: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      last = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || !last) return;
      this.yawOffset += (e.clientX - last.x) * 0.006;
      this.elevOffset = Math.max(-12, Math.min(50, this.elevOffset + (e.clientY - last.y) * 0.15));
      last = { x: e.clientX, y: e.clientY };
    });
    const end = () => {
      this.dragging = false;
      last = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(0.5, Math.min(3, this.zoom * Math.exp(e.deltaY * 0.001)));
      },
      { passive: false },
    );
  }

  cycle(): CameraMode {
    const order: CameraMode[] = ['chase', 'far', 'top'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length]!;
    return this.mode;
  }

  /** Heading the camera looks along (for the HUD arrow and the mini-map). */
  get headingRad(): number {
    return this.heading;
  }

  /** Next update jumps straight to the rover; `intro` starts a descent from high above. */
  snap(headingRad: number, intro = false): void {
    this.heading = headingRad;
    this.yawOffset = 0;
    this.elevOffset = 0;
    this.snapped = false;
    this.intro = intro ? 1 : 0;
  }

  orbit(rad: number): void {
    this.yawOffset += rad;
  }

  update(input: RigInput, dt: number): void {
    this.time += dt;
    const cfg = MODES[this.mode];
    if (!this.dragging && Math.abs(input.speed) > 0.4) {
      this.yawOffset *= 1 - follow(dt, 1.4);
      this.elevOffset *= 1 - follow(dt, 1.8);
    }
    // Close-up of the arm while coring: from the front-left side, lower and nearer.
    const c = input.coring * input.coring * (3 - 2 * input.coring);
    const wantedHeading = input.headingRad + this.yawOffset + c * 2.35;
    this.heading +=
      wrapAngle(wantedHeading - this.heading) * follow(dt, this.dragging ? 0.04 : 0.3);
    let dist = cfg.distM * this.zoom * (1 - c) + 5.2 * c;
    let elev = ((cfg.elevDeg + this.elevOffset) * (1 - c) + 9 * c) * (Math.PI / 180);
    // Intro: from 260 m away, high above, easing into the chase position.
    if (this.intro > 0) {
      this.intro = Math.max(0, this.intro - dt / 3.6);
      const k = this.intro * this.intro * (3 - 2 * this.intro);
      dist = dist + (260 - dist) * k;
      elev = elev + (1.1 - elev) * k;
    }
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    this.wantLook.copy(input.at).setY(input.at.y + AIM_UP_M * (1 - c) + 0.3 * c);
    this.wantLook.lerp(input.drill, c);
    this.wantPos.set(
      this.wantLook.x - fx * dist * Math.cos(elev),
      this.wantLook.y + dist * Math.sin(elev),
      this.wantLook.z - fz * dist * Math.cos(elev),
    );
    const floor = input.ground(this.wantPos.x, this.wantPos.z) + CLEARANCE_M;
    if (this.wantPos.y < floor) this.wantPos.y = floor;
    if (!this.snapped) {
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
      this.snapped = true;
    } else {
      this.pos.lerp(this.wantPos, follow(dt, this.intro > 0 ? 0.05 : 0.16));
      this.look.lerp(this.wantLook, follow(dt, 0.07));
      const g = input.ground(this.pos.x, this.pos.z) + CLEARANCE_M;
      if (this.pos.y < g) this.pos.y = g;
    }
    this.camera.position.copy(this.pos);
    // Shake on rough ground (a few centimetres), smooth noise from summed sines.
    const s = Math.min(1, input.rough) * Math.min(1, Math.abs(input.speed) / 4) * 0.05 * (1 - c);
    const t = this.time;
    this.camera.position.x += s * (Math.sin(t * 23.1) + 0.5 * Math.sin(t * 41.7));
    this.camera.position.y += s * (Math.sin(t * 19.3 + 1) + 0.5 * Math.sin(t * 37.9));
    this.camera.lookAt(this.look);
  }
}
