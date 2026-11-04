import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';

/**
 * Ingenuity, the Mars helicopter, built at its real size (no model is bundled): a 14 × 16 × 20 cm
 * fuselage on four 38 cm legs, two coaxial counter-rotating rotors 1.21 m across, and the solar
 * panel on top of the mast (0.49 m tall in all). Its flights follow the real ones in outline:
 * spin-up, climb to about 10 m, a straight leg to the next airfield, descent, spin-down. They are
 * shortened to under half a minute (the real ones lasted about two).
 */

/** Real rotor speed (2,537 rpm) and the game's flight profile. */
export const ROTOR_RAD_S = (2537 / 60) * 2 * Math.PI;
const FLY = {
  spinUpS: 2.5,
  spinDownS: 2,
  cruiseM: 10,
  hopM: 5,
  climbMps: 2.5,
  speedMps: 4.5,
  descendMps: 1.6,
  hoverS: 0.8,
};

type Phase = 'spinup' | 'climb' | 'cruise' | 'hover' | 'descend' | 'spindown';

export interface FlightStatus {
  /** Height above the ground (m), and how hard the rotors blow (0–1). */
  altitudeM: number;
  rotor: number;
  /** The flight just ended this frame. */
  landed: boolean;
}

export class Ingenuity {
  readonly root = new Group();
  private readonly rotors: Array<{ blades: Group; disc: Mesh; dir: number }> = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private flight: {
    from: Vector3;
    to: Vector3;
    phase: Phase;
    t: number;
    altM: number;
    groundM: number;
    peakM: number;
  } | null = null;
  private spin = 0;
  private angle = 0;
  private readonly pos = new Vector3();
  private headingRad = 0;

  constructor() {
    const body = this.mat(
      new MeshStandardMaterial({
        color: new Color(0.62, 0.45, 0.22),
        roughness: 0.45,
        metalness: 0.6,
      }),
    );
    const carbon = this.mat(
      new MeshStandardMaterial({
        color: new Color(0.06, 0.06, 0.07),
        roughness: 0.55,
        metalness: 0.2,
      }),
    );
    const grey = this.mat(
      new MeshStandardMaterial({
        color: new Color(0.55, 0.56, 0.58),
        roughness: 0.5,
        metalness: 0.5,
      }),
    );
    const solar = this.mat(
      new MeshStandardMaterial({
        color: new Color(0.05, 0.08, 0.16),
        roughness: 0.25,
        metalness: 0.4,
      }),
    );
    const add = (
      g: BufferGeometry,
      m: Material,
      x: number,
      y: number,
      z: number,
      parent: Group = this.root,
    ) => {
      this.geometries.push(g);
      const mesh = new Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(new BoxGeometry(0.195, 0.136, 0.163), body, 0, 0.2, 0);
    // Legs: from the fuselage's lower corners out to the feet.
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const top = new Vector3(sx * 0.07, 0.15, sz * 0.06);
      const foot = new Vector3(sx * 0.27, 0.01, sz * 0.24);
      const len = top.distanceTo(foot);
      const leg = add(new CylinderGeometry(0.0055, 0.0055, len, 6), carbon, 0, 0, 0);
      leg.position.copy(top).add(foot).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), foot.clone().sub(top).normalize());
      add(new CylinderGeometry(0.022, 0.026, 0.01, 10), grey, foot.x, 0.005, foot.z);
    }
    add(new CylinderGeometry(0.012, 0.012, 0.22, 8), grey, 0, 0.38, 0);
    add(new BoxGeometry(0.165, 0.006, 0.09), solar, 0, 0.49, 0);
    // Rotors: lower and upper, counter-rotating; a faint disc stands in for the blades at speed.
    const disc = this.mat(
      new MeshBasicMaterial({
        color: new Color(0.12, 0.11, 0.1),
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    for (const [y, dir] of [
      [0.355, 1],
      [0.43, -1],
    ] as const) {
      const blades = new Group();
      blades.position.y = y;
      for (const side of [1, -1]) {
        const b = add(new BoxGeometry(0.56, 0.005, 0.075), carbon, side * 0.32, 0, 0, blades);
        b.rotation.x = side * 0.08; // pitch of the blade
      }
      add(new CylinderGeometry(0.03, 0.03, 0.03, 10), grey, 0, 0, 0, blades);
      this.root.add(blades);
      const g = new CircleGeometry(0.605, 40);
      g.rotateX(-Math.PI / 2);
      this.geometries.push(g);
      const d = new Mesh(g, disc);
      d.position.y = y;
      this.root.add(d);
      this.rotors.push({ blades, disc: d, dir });
    }
    this.root.visible = false;
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  get flying(): boolean {
    return this.flight !== null;
  }
  get position(): Vector3 {
    return this.pos;
  }

  /** Parked on the ground at a point (world), or hidden. */
  place(at: Vector3 | null, headingRad = this.headingRad): void {
    this.flight = null;
    this.spin = 0;
    this.root.visible = !!at;
    if (!at) return;
    this.pos.copy(at);
    this.headingRad = headingRad;
    this.root.position.copy(at);
    this.root.rotation.set(0, -headingRad, 0);
  }

  /** Flies from where it is to a point on the ground (a hop when it is the same airfield). */
  fly(to: Vector3): void {
    const hop = to.distanceTo(this.pos) < 2;
    this.flight = {
      from: this.pos.clone(),
      to: to.clone(),
      phase: 'spinup',
      t: 0,
      altM: 0,
      groundM: this.pos.y,
      peakM: hop ? FLY.hopM : FLY.cruiseM,
    };
    if (!hop) this.headingRad = Math.atan2(to.x - this.pos.x, -(to.z - this.pos.z));
  }

  update(dt: number, groundY: (x: number, z: number) => number): FlightStatus {
    const f = this.flight;
    let landed = false;
    let target = 0;
    if (f) {
      f.t += dt;
      const dist = Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z);
      switch (f.phase) {
        case 'spinup':
          target = 1;
          if (f.t >= FLY.spinUpS) [f.phase, f.t] = ['climb', 0];
          break;
        case 'climb':
          target = 1;
          f.altM = Math.min(f.peakM, f.t * FLY.climbMps);
          if (f.altM >= f.peakM) [f.phase, f.t] = [dist > 2 ? 'cruise' : 'hover', 0];
          break;
        case 'cruise': {
          target = 1;
          const k = Math.min(1, (f.t * FLY.speedMps) / dist);
          const e = k * k * (3 - 2 * k);
          this.pos.x = f.from.x + (f.to.x - f.from.x) * e;
          this.pos.z = f.from.z + (f.to.z - f.from.z) * e;
          if (k >= 1) [f.phase, f.t] = ['hover', 0];
          break;
        }
        case 'hover':
          target = 1;
          if (f.t >= FLY.hoverS) [f.phase, f.t] = ['descend', 0];
          break;
        case 'descend':
          target = 1;
          f.altM = Math.max(0, f.peakM - f.t * FLY.descendMps);
          if (f.altM <= 0) [f.phase, f.t] = ['spindown', 0];
          break;
        case 'spindown':
          target = 0;
          if (f.t >= FLY.spinDownS) {
            this.flight = null;
            landed = true;
          }
          break;
      }
      const ground = groundY(this.pos.x, this.pos.z);
      // Over the ground below; never below it.
      f.groundM += (ground - f.groundM) * Math.min(1, dt * 2);
      this.pos.y = Math.max(ground, f.groundM + f.altM);
      if (landed) this.pos.y = ground;
    }
    // Rotor speed eases up and down; blades drawn at a slow, readable rate, a disc at speed.
    this.spin += (target - this.spin) * Math.min(1, dt * (target > this.spin ? 1.1 : 1.6));
    this.angle += dt * this.spin * 55;
    for (const r of this.rotors) {
      r.blades.rotation.y = r.dir * this.angle;
      (r.disc.material as MeshBasicMaterial).opacity = 0.22 * Math.max(0, (this.spin - 0.4) / 0.6);
      r.blades.visible = this.spin < 0.85;
    }
    // A slight forward lean while it travels.
    const lean = f?.phase === 'cruise' ? 0.12 : 0;
    this.root.position.copy(this.pos);
    this.root.rotation.set(-lean * Math.cos(0), -this.headingRad, 0, 'YXZ');
    return { altitudeM: f?.altM ?? 0, rotor: this.spin, landed };
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
