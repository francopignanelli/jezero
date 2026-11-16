import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
  Euler,
  type Material,
} from 'three';

/**
 * The landing hardware of Mars 2020 on the ground, where HiRISE saw it the day after landing
 * (data/catalog/landing-hardware.json), built to the published sizes:
 * - the 21.5 m parachute, collapsed on the ground, still tied by its suspension lines to
 * - the backshell (4.5 m across), broken on impact at about 126 km/h, debris round it;
 * - the heat shield (4.5 m), its charred ablative side up, in its own small impact scar;
 * - the descent stage's wreckage, flung out in a V that points back toward the rover.
 * The marks on the ground (the rover's landing blast, the V of the descent stage's debris, the
 * impact scars) are drawn by the terrain shader from `marks`. Shapes and poses are illustrative:
 * HiRISE resolves position and extent, not how each piece lies.
 */

export type HardwareKind = 'parachute' | 'backshell' | 'descent-stage' | 'heat-shield';

export interface HardwarePlace {
  kind: HardwareKind;
  /** Local position (x east, north) and the ground height there. */
  x: number;
  north: number;
}

/** A mark for the terrain shader: centre (x, north), radius (m), type; and a direction. */
export interface GroundMark {
  x: number;
  north: number;
  radiusM: number;
  /** 1: the rover's landing blast; 2: a debris V opening along `dir`; 3: an impact scar. */
  type: 1 | 2 | 3;
  dir: [number, number];
}

const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * The canopy's colours: its red-orange and white gores spell "Dare Mighty Things" in binary in
 * three rings, and JPL's coordinates in the outer one (as decoded publicly within hours of the
 * landing). Here each character is a group of ten gores (three framing, seven bits, A = 1): the
 * manner of the real canopy, not a gore-for-gore copy. Dust dulls both colours.
 */
function canopyTexture(): CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const orange = '#9a3a1c';
  const white = '#c9beab';
  const rings: Array<[number, number, string]> = [
    [0.12, 0.33, 'DARE'],
    [0.33, 0.55, 'MIGHTY'],
    [0.55, 0.77, 'THINGS'],
    [0.79, 1.0, '34 11 58 N 118 10 31 W'],
  ];
  const GORES = 80;
  g.fillStyle = white;
  g.fillRect(0, 0, S, S);
  for (const [r0, r1, text] of rings) {
    const bits: number[] = [];
    for (const ch of text) {
      const v = ch === ' ' ? 0 : /\d/.test(ch) ? Number(ch) + 27 : ch.charCodeAt(0) - 64;
      bits.push(1, 1, 1, ...Array.from({ length: 7 }, (_, i) => (v >> (6 - i)) & 1));
    }
    for (let k = 0; k < GORES; k++) {
      const on = bits[k % bits.length] === 1;
      g.fillStyle = on ? orange : white;
      g.beginPath();
      const a0 = (k / GORES) * Math.PI * 2;
      const a1 = ((k + 1) / GORES) * Math.PI * 2;
      g.arc(S / 2, S / 2, (r1 * S) / 2, a0, a1);
      g.arc(S / 2, S / 2, (r0 * S) / 2, a1, a0, true);
      g.closePath();
      g.fill();
    }
  }
  // Seams between gores, the vent at the apex, and dust in patches.
  g.strokeStyle = 'rgba(60, 40, 30, 0.35)';
  g.lineWidth = 1;
  for (let k = 0; k < GORES; k++) {
    const a = (k / GORES) * Math.PI * 2;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * S * 0.06, S / 2 + Math.sin(a) * S * 0.06);
    g.lineTo(S / 2 + Math.cos(a) * S * 0.5, S / 2 + Math.sin(a) * S * 0.5);
    g.stroke();
  }
  g.fillStyle = '#3a2a20';
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.06, 0, Math.PI * 2);
  g.fill();
  const rand = mulberry(7);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(150, 100, 70, ${0.04 + 0.08 * rand()})`;
    g.beginPath();
    g.arc(rand() * S, rand() * S, 4 + 30 * rand(), 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Charred ablative tiles (the heat shield's PICA), seen from outside. */
function tilesTexture(): CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rand = mulberry(11);
  for (let y = 0; y < S; y += 16)
    for (let x = 0; x < S; x += 16) {
      // Charred, then a year of dust settling on it: dark brown rather than black.
      const v = 52 + rand() * 26;
      g.fillStyle = `rgb(${v + 8}, ${v}, ${v - 6})`;
      g.fillRect(x, y, 16, 16);
    }
  g.strokeStyle = 'rgba(10, 8, 6, 0.8)';
  for (let i = 0; i <= S; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, S);
    g.moveTo(0, i);
    g.lineTo(S, i);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class LandingSite {
  readonly group = new Group();
  readonly materials: Material[] = [];
  readonly marks: GroundMark[] = [];
  private readonly solids: Array<{ x: number; north: number; radiusM: number; heightM: number }> =
    [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    places: HardwarePlace[],
    blast: { x: number; north: number } | null,
    private readonly ground: (x: number, north: number) => number,
  ) {
    if (blast) {
      this.marks.push({ x: blast.x, north: blast.north, radiusM: 18, type: 1, dir: [0, 1] });
    }
    const chute = places.find((p) => p.kind === 'parachute');
    const shell = places.find((p) => p.kind === 'backshell');
    for (const p of places) {
      if (p.kind === 'parachute') this.parachute(p, shell);
      else if (p.kind === 'backshell') this.backshell(p, chute);
      else if (p.kind === 'heat-shield') this.heatShield(p);
      else this.descentStage(p, blast);
    }
  }

  private mat(m: MeshStandardMaterial): MeshStandardMaterial {
    this.materials.push(m);
    return m;
  }

  private add(mesh: Mesh | InstancedMesh): void {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(mesh.geometry);
  }

  /** The canopy collapsed on the ground: a disc folded in along one axis, pleated at the gores. */
  private parachute(p: HardwarePlace, shell: HardwarePlace | undefined): void {
    const R = 10.75;
    const rings = 28;
    const segs = 160;
    const toShell = shell ? Math.atan2(shell.north - p.north, shell.x - p.x) : 0;
    // Folded along the line to the backshell (the lines pulled it that way as it settled).
    const ax = Math.cos(toShell);
    const an = Math.sin(toShell);
    const pos: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const rand = mulberry(3);
    const phase = Array.from({ length: 6 }, () => rand() * Math.PI * 2);
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i <= segs; i++) {
        const r = (j / rings) * R;
        const a = (i / segs) * Math.PI * 2;
        // Folded to about half its width across the pull, a little longer along it.
        // An irregular outline: the folded canopy is lumpy, not an ellipse.
        const edge = 0.82 + 0.18 * Math.sin(a * 3 + phase[0]!) + 0.1 * Math.sin(a * 7 + phase[3]!);
        const lx = Math.cos(a) * r * 0.95 * edge;
        const lw = Math.sin(a) * r * 0.66 * edge;
        const x = p.x - (ax * lx - an * lw);
        const n = p.north - (an * lx + ax * lw);
        // Pleats between gores, a few big folds, air trapped near the apex.
        const pleat = 0.05 * Math.abs(Math.sin(a * 40)) * (r / R);
        const fold =
          0.38 * Math.max(0, Math.sin(a * 2 + phase[1]!) * Math.sin(r * 0.9 + phase[2]!)) +
          0.2 * Math.max(0, Math.sin(a * 5 + phase[3]!) * Math.cos(r * 1.7 + phase[4]!));
        const pocket = 0.55 * Math.exp(-((r - 3) ** 2) / 4) * (0.5 + 0.5 * Math.sin(a + phase[5]!));
        const y = this.ground(x, n) + 0.03 + (pleat + fold + pocket) * (1 - (r / R) ** 4 * 0.6);
        pos.push(x, y, -n);
        uv.push(0.5 + (Math.cos(a) * r) / (2 * R), 0.5 + (Math.sin(a) * r) / (2 * R));
        if (j < rings && i < segs) {
          const k = j * (segs + 1) + i;
          index.push(k, k + 1, k + segs + 1, k + 1, k + segs + 2, k + segs + 1);
        }
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const tex = canopyTexture();
    this.disposables.push(tex);
    const mesh = new Mesh(
      geo,
      this.mat(new MeshStandardMaterial({ map: tex, roughness: 0.92, side: DoubleSide })),
    );
    this.add(mesh);
    // The canopy is soft: the rover may not drive over it, but it does not lift the wheels.
    this.solids.push({ x: p.x, north: p.north, radiusM: 6, heightM: 0.25 });
  }

  /** The backshell: a cone broken open on one side, its parachute cone, and the debris round it. */
  private backshell(p: HardwarePlace, chute: HardwarePlace | undefined): void {
    const pts = [
      new Vector2(2.25, 0),
      new Vector2(2.1, 0.25),
      new Vector2(1.2, 1.55),
      new Vector2(0.75, 1.75),
      new Vector2(0.7, 2.15),
      new Vector2(0.6, 2.2),
    ];
    // Broken open: a sector of the cone is missing.
    const geo = new LatheGeometry(pts, 48, 0.9, Math.PI * 2 - 0.7);
    const shell = new Mesh(
      geo,
      this.mat(
        new MeshStandardMaterial({
          color: new Color(0.5, 0.47, 0.42),
          roughness: 0.85,
          side: DoubleSide,
        }),
      ),
    );
    // Tipped over, resting on its rim and side.
    const y = this.ground(p.x, p.north);
    shell.position.set(p.x, y - 0.35, -p.north);
    shell.rotation.set(1.15, 1.7, 0.2);
    this.add(shell);
    this.solids.push({ x: p.x, north: p.north, radiusM: 2.6, heightM: 2.2 });
    this.marks.push({ x: p.x, north: p.north, radiusM: 9, type: 3, dir: [1, 0] });
    this.debris(p.x, p.north, 70, 14, new Color(0.6, 0.57, 0.52), 0.15, 0.9, 21);
    // Suspension lines: bundles from the backshell to the canopy's edge, slack on the ground.
    if (chute) {
      const lineMat = this.mat(
        new MeshStandardMaterial({ color: new Color(0.7, 0.64, 0.56), roughness: 0.9 }),
      );
      const rand = mulberry(5);
      for (let b = 0; b < 7; b++) {
        const curve: Vector3[] = [];
        const ex = chute.x + (rand() - 0.5) * 6;
        const en = chute.north + (rand() - 0.5) * 6;
        for (let k = 0; k <= 12; k++) {
          const f = k / 12;
          const x = p.x + (ex - p.x) * f + Math.sin(f * Math.PI * (1 + b)) * (rand() - 0.5) * 1.5;
          const n = p.north + (en - p.north) * f + Math.cos(f * Math.PI * 2) * (rand() - 0.5) * 1.5;
          const lift = k === 0 ? 1.1 : 0.04;
          curve.push(new Vector3(x, this.ground(x, n) + lift, -n));
        }
        const tube = new Mesh(new TubeGeometry(new CatmullRomCurve3(curve), 60, 0.025, 4), lineMat);
        tube.castShadow = false;
        this.group.add(tube);
        this.disposables.push(tube.geometry);
      }
    }
  }

  /** The heat shield, charred side up and tilted, half buried in its own impact scar. */
  private heatShield(p: HardwarePlace): void {
    const pts: Vector2[] = [];
    for (let k = 0; k <= 16; k++) {
      const r = (k / 16) * 2.25;
      // 70° sphere-cone: a spherical nose, then a straight cone, a rounded shoulder.
      const h = r < 0.6 ? 0.75 - (r * r) / 2.4 : 0.6 - (r - 0.6) * 0.36;
      pts.push(new Vector2(r, Math.max(0, h)));
    }
    const geo = new LatheGeometry(pts, 64);
    const tex = tilesTexture();
    tex.repeat.set(6, 3);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    this.disposables.push(tex);
    const shield = new Mesh(
      geo,
      this.mat(new MeshStandardMaterial({ map: tex, roughness: 0.95, side: DoubleSide })),
    );
    const y = this.ground(p.x, p.north);
    shield.position.set(p.x, y - 0.45, -p.north);
    shield.rotation.set(0.5, 0.6, -0.2);
    this.add(shield);
    this.solids.push({ x: p.x, north: p.north, radiusM: 2.4, heightM: 1.2 });
    this.marks.push({ x: p.x, north: p.north, radiusM: 12, type: 3, dir: [1, 0] });
    this.debris(p.x, p.north, 30, 8, new Color(0.13, 0.11, 0.1), 0.1, 0.5, 31);
  }

  /** The descent stage's wreckage, flung out downrange: a V opening away from the rover. */
  private descentStage(p: HardwarePlace, rover: { x: number; north: number } | null): void {
    const dir = rover
      ? new Vector2(p.x - rover.x, p.north - rover.north).normalize()
      : new Vector2(-0.6, 0.8);
    this.marks.push({ x: p.x, north: p.north, radiusM: 70, type: 2, dir: [dir.x, dir.y] });
    this.marks.push({ x: p.x, north: p.north, radiusM: 10, type: 3, dir: [dir.x, dir.y] });
    // The main wreck: a crumpled frame and a propellant tank.
    const frame = new Mesh(
      new CylinderGeometry(0.9, 1.3, 0.7, 7, 1, true),
      this.mat(
        new MeshStandardMaterial({
          color: new Color(0.35, 0.33, 0.3),
          metalness: 0.6,
          roughness: 0.55,
          side: DoubleSide,
        }),
      ),
    );
    const y = this.ground(p.x, p.north);
    frame.position.set(p.x, y + 0.15, -p.north);
    frame.rotation.set(0.6, 0.3, 0.9);
    this.add(frame);
    const tank = new Mesh(
      new CylinderGeometry(0.35, 0.35, 1.0, 12),
      this.mat(
        new MeshStandardMaterial({
          color: new Color(0.55, 0.5, 0.42),
          metalness: 0.7,
          roughness: 0.4,
        }),
      ),
    );
    tank.position.set(
      p.x + dir.x * 6,
      this.ground(p.x + dir.x * 6, p.north + dir.y * 6) + 0.25,
      -(p.north + dir.y * 6),
    );
    tank.rotation.set(Math.PI / 2, 0, 0.7);
    this.add(tank);
    this.solids.push({ x: p.x, north: p.north, radiusM: 1.8, heightM: 1 });
    // Debris along the V (±25° about the direction of flight), denser near the impact.
    const rand = mulberry(17);
    const list: Array<[number, number]> = [];
    for (let i = 0; i < 140; i++) {
      const along = 3 + 60 * rand() ** 1.6;
      const ang = (rand() - 0.5) * 0.9;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      list.push([p.x + (dir.x * c - dir.y * s) * along, p.north + (dir.x * s + dir.y * c) * along]);
    }
    this.debrisAt(list, new Color(0.42, 0.4, 0.37), 0.12, 0.8, 41, 0.5);
  }

  private debris(
    x: number,
    north: number,
    n: number,
    spread: number,
    colour: Color,
    min: number,
    max: number,
    seed: number,
  ): void {
    const rand = mulberry(seed);
    const list: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const r = spread * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      list.push([x + Math.cos(a) * r, north + Math.sin(a) * r]);
    }
    this.debrisAt(list, colour, min, max, seed + 1, 0.2);
  }

  /** Flat, angular fragments (panels, foil, insulation) lying on the ground. */
  private debrisAt(
    list: Array<[number, number]>,
    colour: Color,
    min: number,
    max: number,
    seed: number,
    metal: number,
  ): void {
    const geo = new CylinderGeometry(0.5, 0.5, 0.06, 5);
    const mesh = new InstancedMesh(
      geo,
      this.mat(new MeshStandardMaterial({ color: colour, metalness: metal, roughness: 0.6 })),
      list.length,
    );
    const rand = mulberry(seed);
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const s = new Vector3();
    const t = new Vector3();
    list.forEach(([x, n], i) => {
      const size = min + (max - min) * rand() ** 2;
      e.set((rand() - 0.5) * 0.6, rand() * Math.PI * 2, (rand() - 0.5) * 0.6);
      q.setFromEuler(e);
      s.set(size * (0.6 + 0.8 * rand()), 1 + rand(), size * (0.5 + 0.6 * rand()));
      t.set(x, this.ground(x, n) + 0.02, -n);
      m.compose(t, q, s);
      mesh.setMatrixAt(i, m);
    });
    this.add(mesh);
  }

  /** Height of the hardware above the ground at a local point (0 off it): what the wheels touch. */
  liftAt(x: number, north: number): number {
    let lift = 0;
    for (const o of this.solids) {
      const d2 = (o.x - x) ** 2 + (o.north - north) ** 2;
      if (d2 < o.radiusM * o.radiusM)
        lift = Math.max(lift, o.heightM * Math.sqrt(1 - d2 / o.radiusM ** 2));
    }
    return lift;
  }

  /** Obstacles for AutoNav's map. */
  obstacles(): Array<{ x: number; north: number; radiusM: number }> {
    return this.solids.map(({ x, north, radiusM }) => ({ x, north, radiusM }));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const m of this.materials) m.dispose();
  }
}
