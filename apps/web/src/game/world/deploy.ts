import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Path,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import type { DustParticles } from './effects';
import type { Ingenuity } from './ingenuity';

/** The deployment as drawn (see World.setDeploy). */
export interface DeployView {
  stage: 'stowed' | 'lying' | 'upright' | 'down';
  anim: 'shield' | 'rotate' | 'drop' | null;
  /** How far along the step under way (0–1), and how long that step runs (s). */
  p: number;
  seconds: number;
  /** The rover's heading (rad): the helicopter is set down facing the same way. */
  headingRad: number;
  /** Where the shield lies when it was dropped before this session (local x, north). */
  shieldAt?: [number, number] | null;
}

/**
 * The deployment's geometry, in the rover's frame (m; +z forward, +x to the rover's left, y up),
 * from WATSON's images of sols 30–43 (PIA24448, PIA24424, PIA24441, PIA24442, PIA24443, PIA24449)
 * fitted to the rover model (its belly is 0.67 m up):
 * - Ingenuity rides on its side under the belly, mast towards the middle, body to the rover's right
 *   (on the left as WATSON saw it from in front), rotor
 *   blades locked along the rover's length; the Mars Helicopter Delivery System (MHDS) holds it by
 *   the top of its mast in a collar on an arm that turns about a hinge pin running fore and aft.
 * - The arm swings it down through 90° in the rover's cross-section until it hangs upright, feet
 *   1.5 cm off the ground; it is then released.
 * - The debris shield, a deep tray shaped to the stowed helicopter (its body, and its rotors across),
 *   hangs below it and falls first.
 * Every stage was checked against the belly, the wheels and the ground (see docs/decisions.md).
 */
const BELLY_Y = 0.67;
/** The side the helicopter lies towards when stowed (-1: the rover's right, its -x). */
const SIDE = -1;
const HINGE = new Vector3(SIDE * 0.08, 0.615, 0);
/** Hinge pin to the top of the mast (the collar), with the helicopter upright. */
const ARM = new Vector3(-SIDE * 0.08, -0.044, 0);
/** Mars's surface gravity (m/s²): falls are timed with it. */
const G = 3.71;
const DEG = Math.PI / 180;
/** The tray: its length (across the rover) and centre, wall height, the bottom's height on board. */
const TRAY = { length: 0.72, cx: SIDE * 0.36, wall: 0.225, y: 0.42 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoother = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * A spring-loaded leg swinging open (fold 1 → 0 over x 0–1): it gathers speed, meets its stop and
 * settles with a small damped rebound (never more than 2° past its stop).
 */
function legOpen(x: number): number {
  if (x <= 0) return 1;
  if (x < 0.7) return 1 - smoother(x / 0.7);
  const t = clamp01((x - 0.7) / 0.3);
  return -0.016 * Math.exp(-4 * t) * Math.sin(2 * Math.PI * t);
}

/**
 * The swing, in the order WATSON photographed it (sols 36–39), each stage finishing before the
 * next: the launch lock lets go (a settle of a few millimetres); the arm's motor swings the
 * helicopter from lying (90°) to 12° from vertical; the two legs on its upper side spring open; the
 * arm brings it upright; the last two legs open. Seconds into the step (10 s).
 */
export const ROTATE_STAGES = { unlock: 0.8, swing1: 4.8, legsA: 6.0, swing2: 7.8, legsB: 9.2 };
function rotatePose(t: number): { tiltDeg: number; legsUp: number; legsDown: number; lock: number } {
  const S = ROTATE_STAGES;
  let tiltDeg = 90;
  if (t >= S.unlock) tiltDeg = t < S.swing1 ? 90 - 78 * smoother((t - S.unlock) / (S.swing1 - S.unlock)) : 12;
  if (t >= S.legsA + 0.2) tiltDeg = 12 * (1 - smoother((t - S.legsA - 0.2) / (S.swing2 - S.legsA - 0.2)));
  return {
    tiltDeg,
    // The pair on its upper side as it swings opens first (the other would meet the ground).
    legsUp: legOpen((t - (S.swing1 + 0.2)) / 0.9),
    legsDown: legOpen((t - (S.swing2 + 0.3)) / 1.0),
    lock: t < S.unlock ? smoother(t / S.unlock) : 1,
  };
}

/** When the collar opens and lets the helicopter go (s into the drop step). */
const RELEASE_S = 0.85;

/** The deployment's mechanical stages, named for the player (one line each on screen). */
export type DeployStage = 'shield' | 'unlock' | 'swing' | 'legsA' | 'upright' | 'legsB' | 'release' | 'down';

/** The stage a deployment step is at, `t` s into it (null for other sequences). */
export function deployStage(kind: string, t: number): DeployStage | null {
  const S = ROTATE_STAGES;
  if (kind === 'shield') return 'shield';
  if (kind === 'drop') return t < RELEASE_S ? 'release' : 'down';
  if (kind !== 'rotate') return null;
  if (t < S.unlock) return 'unlock';
  if (t < S.swing1 + 0.2) return 'swing';
  if (t < S.swing1 + 1.1) return 'legsA';
  if (t < S.swing2 + 0.3) return 'upright';
  return 'legsB';
}

/**
 * The tray's fall (its own frame: length along z, bottom at y) t s into the shield step, over
 * ground `ground`. One end lets go first and it swings down about the other (a plate hinged at one
 * end, under Mars gravity) until its free end meets the ground; then the held end lets go and it
 * falls flat, rocks once and rests, open side up (as WATSON saw it, PIA24448).
 */
function trayPose(t: number, ground: number): { y: number; z: number; tilt: number; yaw: number; hit1: number; hit2: number; end: number } {
  const L = TRAY.length;
  const alpha = (3 * G) / (2 * L);
  const thetaC = Math.asin(Math.min(0.95, Math.max(0.02, (TRAY.y - ground) / L)));
  const tSwing = Math.sqrt((2 * thetaC) / alpha);
  // It lets go once the camera has settled on it.
  const t0 = 1.5;
  const hit1 = t0 + tSwing;
  const hit2 = hit1 + tSwing * 0.8;
  const end = hit2 + 0.5;
  const zFoot = -L / 2 + L * Math.cos(thetaC);
  if (t < t0) return { y: TRAY.y - 0.003 * smoother(t / t0), z: 0, tilt: 0, yaw: 0, hit1, hit2, end };
  if (t < hit1) {
    const th = Math.min(thetaC, 0.5 * alpha * (t - t0) ** 2);
    return { y: TRAY.y - (L / 2) * Math.sin(th), z: -L / 2 + (L / 2) * Math.cos(th), tilt: th, yaw: 0, hit1, hit2, end };
  }
  if (t < hit2) {
    const k = (t - hit1) / (hit2 - hit1);
    const ph = thetaC * (1 - k * k);
    return { y: ground + (L / 2) * Math.sin(ph), z: zFoot - (L / 2) * Math.cos(ph), tilt: ph, yaw: 0, hit1, hit2, end };
  }
  const u = t - hit2;
  const rock = u < 0.5 ? -1.2 * DEG * Math.exp(-6 * u) * Math.sin((2 * Math.PI * u) / 0.25) : 0;
  const slide = 1 - Math.exp(-8 * u);
  return { y: ground, z: zFoot - L / 2 - 0.03 * slide, tilt: rock, yaw: 3 * DEG * slide, hit1, hit2, end };
}

/** A rounded polygon (corner radius r) as a Shape, or a Path for a hole; points in (x, z). */
function rounded<T extends Shape | Path>(into: T, pts: Array<[number, number]>, r: number): T {
  const n = pts.length;
  const at = (i: number) => pts[(i + n) % n]!;
  for (let i = 0; i < n; i++) {
    const [px, pz] = at(i - 1);
    const [cx, cz] = at(i);
    const [nx, nz] = at(i + 1);
    const a = Math.hypot(cx - px, cz - pz);
    const b = Math.hypot(nx - cx, nz - cz);
    const ra = Math.min(r, a / 2);
    const rb = Math.min(r, b / 2);
    // Shape space is (x, -z): extruded along +z, then turned so that it stands along +y.
    const sx = cx + ((px - cx) / a) * ra;
    const sz = cz + ((pz - cz) / a) * ra;
    const ex = cx + ((nx - cx) / b) * rb;
    const ez = cz + ((nz - cz) / b) * rb;
    if (i === 0) into.moveTo(sx, -sz);
    else into.lineTo(sx, -sz);
    into.quadraticCurveTo(cx, -cz, ex, -ez);
  }
  into.closePath();
  return into;
}

/** The tray's outline in its frame (x across, z along): its body bar, and a bar across for the rotors. */
function trayOutline(inset: number): Array<[number, number]> {
  const [bw, bl] = [0.17 - inset, 0.36 - inset];
  const [rw, r0, r1] = [0.66 - inset, -0.21 + inset, 0.04 - inset];
  return [
    [-bw, -bl],
    [bw, -bl],
    [bw, r0],
    [rw, r0],
    [rw, r1],
    [bw, r1],
    [bw, bl],
    [-bw, bl],
    [-bw, r1],
    [-rw, r1],
    [-rw, r0],
    [-bw, r0],
  ];
}

/** Grey paint on the tray: mottling, scuffs and Mars dust (tiled; extrusions take UVs in metres). */
function trayTexture(): Texture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#9a9b98';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 1800; i++) {
    const s = 1 + rnd() * 4;
    g.fillStyle = rnd() < 0.5 ? `rgba(60,60,58,${0.03 + rnd() * 0.05})` : `rgba(240,240,236,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * N, rnd() * N, s, s);
  }
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(70,68,64,${0.1 + rnd() * 0.12})`;
    g.lineWidth = 0.6 + rnd();
    g.beginPath();
    const x = rnd() * N;
    const y = rnd() * N;
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 16);
    g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(165,108,66,${0.05 + rnd() * 0.08})`;
    g.beginPath();
    g.ellipse(rnd() * N, rnd() * N, 4 + rnd() * 22, 3 + rnd() * 10, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(2.2, 2.2);
  t.anisotropy = 4;
  return t;
}

/** A camera shot of the deployment (rover frame): where from, what at, the field of view. */
export interface DeployShot {
  from: Vector3;
  at: Vector3;
  fovDeg: number;
}

/**
 * Ingenuity's deployment as drawn: the debris shield (a painted tray shaped to the stowed
 * helicopter), the delivery system under the belly (mount, hinge pin, arm and the collar holding the
 * mast), the helicopter swung upright on the arm with its legs opening about their hips, its rotor
 * blades locked throughout, released onto its feet, and dust where things land. Poses come from the
 * step under way (its share done and its length), so motion follows the game's clock (and warp).
 */
export class DeployRig {
  readonly tray = new Group();
  /** Fixed to the rover: mount and hinge pin. */
  readonly mount = new Group();
  /** Turns with the helicopter: the arm and the collar. */
  readonly arm = new Group();
  private readonly jaws: Mesh[] = [];
  readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: Texture[] = [];
  /** The tray on the ground (world matrix), once it is down. */
  private trayRest: Matrix4 | null = null;
  private lastT = -1;
  private lastAnim: DeployView['anim'] = null;
  private readonly m = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly e = new Euler();
  private readonly inv = new Matrix4();
  private readonly one = new Vector3(1, 1, 1);
  /** The tray in the rover's frame: its centre, turned so its length runs across the rover. */
  private readonly trayBase = new Matrix4().compose(
    new Vector3(TRAY.cx, 0, 0),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (SIDE * Math.PI) / 2),
    new Vector3(1, 1, 1),
  );

  constructor() {
    const tex = trayTexture();
    this.textures.push(tex);
    const paint = new MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.32 });
    const dark = new MeshStandardMaterial({ color: new Color(0.17, 0.17, 0.18), roughness: 0.45, metalness: 0.65 });
    const alu = new MeshStandardMaterial({ color: new Color(0.66, 0.67, 0.69), roughness: 0.34, metalness: 0.85 });
    const gold = new MeshStandardMaterial({ color: new Color(0.78, 0.52, 0.2), roughness: 0.4, metalness: 0.9 });
    this.materials.push(paint, dark, alu, gold);
    const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number, parent: Group) => {
      this.geometries.push(geo);
      const mesh = new Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // ---- the tray: walls (an outline with its inside cut out), a floor, a lip, four fittings ----
    const outer = trayOutline(0);
    const walls = rounded(new Shape(), outer, 0.05);
    walls.holes.push(rounded(new Path(), trayOutline(0.01), 0.04));
    const wallGeo = new ExtrudeGeometry(walls, { depth: TRAY.wall, bevelEnabled: false, curveSegments: 5 });
    wallGeo.rotateX(-Math.PI / 2);
    add(wallGeo, paint, 0, 0, 0, this.tray);
    const floor = new ExtrudeGeometry(rounded(new Shape(), outer, 0.05), { depth: 0.008, bevelEnabled: false, curveSegments: 5 });
    floor.rotateX(-Math.PI / 2);
    add(floor, paint, 0, 0, 0, this.tray);
    const lip = rounded(new Shape(), trayOutline(-0.012), 0.06);
    lip.holes.push(rounded(new Path(), outer, 0.05));
    const lipGeo = new ExtrudeGeometry(lip, { depth: 0.008, bevelEnabled: false, curveSegments: 5 });
    lipGeo.rotateX(-Math.PI / 2);
    add(lipGeo, paint, 0, TRAY.wall - 0.008, 0, this.tray);
    // Release fittings on the lip, where it was bolted to the belly.
    for (const [x, z] of [
      [0, -0.36],
      [0, 0.36],
      [-0.66, -0.085],
      [0.66, -0.085],
    ] as const)
      add(new BoxGeometry(0.035, 0.03, 0.035), dark, x * 0.98, TRAY.wall + 0.012, z * 0.98, this.tray);
    this.tray.matrixAutoUpdate = false;
    this.tray.visible = false;

    // ---- the delivery system ----
    // Mount on the belly, two cheeks and the hinge pin (fore and aft).
    add(new BoxGeometry(0.06, 0.055, 0.13), dark, HINGE.x, BELLY_Y - 0.0275, 0, this.mount);
    for (const z of [-0.042, 0.042]) add(new BoxGeometry(0.04, 0.05, 0.01), alu, HINGE.x, HINGE.y + 0.012, z, this.mount);
    const pin = new CylinderGeometry(0.011, 0.011, 0.105, 18);
    pin.rotateX(Math.PI / 2);
    add(pin, alu, HINGE.x, HINGE.y, 0, this.mount);
    // A harness of cables along the belly to the mount.
    const harness = new CylinderGeometry(0.009, 0.009, 0.32, 10);
    harness.rotateZ(Math.PI / 2);
    add(harness, gold, HINGE.x + SIDE * 0.2, BELLY_Y - 0.012, 0.05, this.mount);
    // The arm (from the pin to the collar), and the collar round the top of the mast with its jaws.
    const len = ARM.length();
    const link = add(new BoxGeometry(len, 0.02, 0.05), alu, ARM.x / 2, ARM.y / 2, 0, this.arm);
    link.rotation.z = Math.atan2(ARM.y, ARM.x);
    add(new CylinderGeometry(0.02, 0.02, 0.07, 14), alu, 0, 0, 0, this.arm); // boss on the pin
    this.arm.children[this.arm.children.length - 1]!.rotation.x = Math.PI / 2;
    add(new CylinderGeometry(0.024, 0.026, 0.05, 18), dark, ARM.x, ARM.y - 0.022, 0, this.arm);
    for (const z of [-0.028, 0.028]) {
      const jaw = add(new BoxGeometry(0.03, 0.04, 0.008), alu, ARM.x, ARM.y - 0.03, z, this.arm);
      jaw.geometry.translate(0, -0.012, 0);
      this.jaws.push(jaw);
    }
    this.mount.matrixAutoUpdate = false;
    this.arm.matrixAutoUpdate = false;
    this.mount.visible = false;
    this.arm.visible = false;
  }

  get objects(): Group[] {
    return [this.tray, this.mount, this.arm];
  }

  /** Hides it all (no deployment on this mission, or it is over). */
  hide(): void {
    this.tray.visible = false;
    this.mount.visible = false;
    this.arm.visible = false;
    this.trayRest = null;
    this.lastT = -1;
    this.lastAnim = null;
  }

  /**
   * The camera for a stage (rover frame): low in front of the rover between its front wheels,
   * looking back under the belly (as WATSON did), with a slow drift through each stage. While the
   * rover rolls off the shield the camera rides with it, so the tray slides away behind.
   */
  shot(d: DeployView | null, driving: boolean): DeployShot {
    const t = d?.anim ? clamp01(d.p) : 0;
    const x = (k: number) => SIDE * k;
    if (d?.anim === 'shield' || driving)
      return { from: new Vector3(x(-0.2), 0.32, 2.4 - 0.1 * t), at: new Vector3(x(0.32), 0.34, 0), fovDeg: 40 };
    if (d?.anim === 'rotate')
      return {
        from: new Vector3(x(-0.15 + 0.15 * t), 0.33, 2.25 - 0.12 * t),
        at: new Vector3(x(0.28 - 0.28 * t), 0.42 - 0.08 * t, 0),
        fovDeg: 38,
      };
    return { from: new Vector3(x(0.05), 0.3, 2.0), at: new Vector3(0, 0.28, 0), fovDeg: 38 };
  }

  /**
   * Each frame, after the rover's pose (`R`, its world matrix): the tray, the delivery system and
   * the helicopter where the deployment has them. `groundY` gives the ground's height (world).
   */
  update(d: DeployView, R: Matrix4, heli: Ingenuity, groundY: (x: number, z: number) => number, dust: DustParticles): void {
    const t = d.anim ? d.p * d.seconds : 0;
    if (d.anim !== this.lastAnim) {
      this.lastAnim = d.anim;
      this.lastT = -1;
    }
    const crossed = (at: number) => this.lastT < at && t >= at;
    this.inv.copy(R).invert();
    const groundAt = (x: number, z: number) => {
      this.v.set(x, 0, z).applyMatrix4(R);
      this.v.y = groundY(this.v.x, this.v.z);
      return this.v.applyMatrix4(this.inv).y;
    };

    // ---- the tray ----
    if (d.stage === 'stowed' && !d.anim && !d.shieldAt) this.trayRest = null;
    if (d.shieldAt && !this.trayRest) {
      const [x, n] = d.shieldAt;
      this.v.set(x, groundY(x, -n), -n);
      this.trayRest = new Matrix4().compose(this.v, this.q.setFromAxisAngle(this.v2.set(0, 1, 0), 0.6), this.one);
    }
    this.tray.visible = true;
    if (this.trayRest) this.tray.matrix.copy(this.trayRest);
    else if (d.anim === 'shield') {
      const ground = groundAt(TRAY.cx, 0);
      const s = trayPose(t, ground);
      this.e.set(s.tilt, s.yaw, 0, 'YXZ');
      this.m.compose(this.v.set(0, s.y, s.z), this.q.setFromEuler(this.e), this.one);
      this.tray.matrix.multiplyMatrices(R, this.m2.multiplyMatrices(this.trayBase, this.m));
      if (crossed(s.hit1)) this.puff(dust, R, [[TRAY.cx + SIDE * (TRAY.length / 2 - 0.05), ground, 0]], 10, 0.2);
      if (crossed(s.hit2))
        this.puff(dust, R, [[TRAY.cx - 0.3, ground, 0], [TRAY.cx + 0.3, ground, 0], [TRAY.cx, ground, -0.5], [TRAY.cx, ground, 0.5]], 9, 0.3);
      if (t >= s.end) this.trayRest = this.tray.matrix.clone();
    } else {
      this.m.makeTranslation(0, TRAY.y, 0);
      this.tray.matrix.multiplyMatrices(R, this.m2.multiplyMatrices(this.trayBase, this.m));
    }

    // ---- the helicopter on its arm ----
    let tiltDeg = 90;
    let legsUp = 1;
    let legsDown = 1;
    // The launch lock holds it tight until the swing; released, the arm settles 2 mm.
    let lockMm = d.stage === 'upright' || d.stage === 'down' ? 2 : 0;
    if (d.stage === 'upright' || d.stage === 'down') [tiltDeg, legsUp, legsDown] = [0, 0, 0];
    if (d.anim === 'rotate') {
      const r = rotatePose(t);
      [tiltDeg, legsUp, legsDown] = [r.tiltDeg, r.legsUp, r.legsDown];
      lockMm = 2 * r.lock;
    }
    const open = d.stage === 'down' ? 1 : d.anim === 'drop' ? smoother((t - 0.5) / (RELEASE_S - 0.5)) : 0;
    // The arm: about the pin, fore and aft (the launch lock lets it settle 2 mm first).
    this.mount.visible = true;
    this.arm.visible = true;
    this.mount.matrix.copy(R);
    this.m.makeTranslation(HINGE.x, HINGE.y - lockMm / 1000, HINGE.z).multiply(this.m2.makeRotationZ(SIDE * tiltDeg * DEG));
    this.arm.matrix.multiplyMatrices(R, this.m);
    this.jaws.forEach((j, i) => (j.rotation.x = (i ? 1 : -1) * open * 18 * DEG));
    if (d.stage === 'down') {
      this.lastT = t;
      return; // on the ground: placed by the session
    }
    // The helicopter hangs from the collar by the top of its mast.
    this.m.multiply(this.m2.makeTranslation(ARM.x, ARM.y - heli.topM, ARM.z));
    this.m.premultiply(R);
    let splay = 0;
    if (d.anim === 'drop' && t >= RELEASE_S) {
      // Released: it falls the last 1.5 cm onto its feet under Mars gravity; the legs flex out a
      // little (the body dips while the feet stay put) and settle. It stands as the rover faces.
      this.m.decompose(this.v, this.q, this.v2);
      const g0 = groundY(this.v.x, this.v.z);
      const h = Math.max(0, this.v.y - g0);
      const tf = Math.sqrt((2 * h) / G);
      const u = t - RELEASE_S;
      let y = u < tf ? this.v.y - 0.5 * G * u * u : g0;
      if (u >= tf) {
        const b = u - tf;
        splay = 0.035 * (1 - Math.exp(-30 * b)) * Math.exp(-6 * b);
        y = g0 - 0.3 * splay;
      }
      // Upright, facing as the rover does (its frame turns π − heading about the vertical).
      this.q2.setFromAxisAngle(this.v2.set(0, 1, 0), Math.PI - d.headingRad);
      this.q.slerp(this.q2, tf > 0 ? clamp01(u / tf) : 1);
      this.v.y = y;
      this.m.compose(this.v, this.q, this.one);
      if (crossed(RELEASE_S + tf)) {
        const feet: Array<[number, number, number]> = [];
        for (const [fx, fz] of [
          [0.3, 0.3],
          [0.3, -0.3],
          [-0.3, 0.3],
          [-0.3, -0.3],
        ] as const) {
          this.v2.set(fx, 0, fz).applyQuaternion(this.q2).add(this.v).applyMatrix4(this.inv);
          feet.push([this.v2.x, groundAt(this.v2.x, this.v2.z), this.v2.z]);
        }
        this.puff(dust, R, feet, 4, 0.1);
      }
    }
    // Blades locked in their stowed line throughout; legs about their hips.
    heli.carry(this.m, 1);
    // The pair on the upper side as it swings is the one on the helicopter's SIDE·x side.
    if (SIDE > 0) heli.setLegs(legsUp, legsDown, splay);
    else heli.setLegs(legsDown, legsUp, splay);
    this.lastT = t;
  }

  /** Dust thrown up and out where something lands (points in the rover's frame). */
  private puff(dust: DustParticles, R: Matrix4, at: Array<[number, number, number]>, each: number, speed: number): void {
    for (const [x, y, z] of at) {
      for (let i = 0; i < each; i++) {
        const a = Math.random() * Math.PI * 2;
        this.v.set(x + Math.cos(a) * 0.05, y + 0.02, z + Math.sin(a) * 0.05).applyMatrix4(R);
        const s = speed * (0.5 + Math.random());
        this.v2.set(Math.cos(a) * s, 0.04 + Math.random() * speed * 0.5, Math.sin(a) * s);
        dust.emit(this.v, this.v2, 0.04 + Math.random() * 0.08, 1.8 + Math.random() * 2.2);
      }
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
