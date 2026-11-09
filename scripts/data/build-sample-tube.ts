/**
 * The Mars 2020 sample tube for the rover game, from NASA's official 3D-printing model
 * (NASA-3D-Resources, "3D Printing/Mars 2020 sample tube/Mars 2020 sample tube.stl", NASA/JPL-Caltech):
 * data/raw/models/ → data/build/models/sample-tube.raw.glb, then glTF-Transform optimise →
 * sample-tube.glb (the command is printed at the end).
 *
 * The STL is a single grey solid in inches (5.6 × 0.94 in): converted to metres (0.142 m long),
 * stood up along +Y with the open end (the crenellated head that takes the core) up and centred on
 * its axis. Shading normals are smoothed between faces less than 40° apart (sharp edges stay sharp).
 * Colours follow NASA's renderings and Mastcam-Z images of real tubes: the white-coated body, gold
 * (titanium nitride) head features and collar, a gold ring and the bare metal at the closed end.
 * The colour bands are set by height along the tube and are approximate.
 *
 * Run: npx tsx scripts/data/build-sample-tube.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'data', 'raw', 'models', 'Mars 2020 sample tube.stl');
const OUT_DIR = join(ROOT, 'data', 'build', 'models');
const RAW_OUT = join(OUT_DIR, 'sample-tube.raw.glb');
const INCH = 0.0254;
const CREASE = Math.cos((40 * Math.PI) / 180);

const WHITE = [0.86, 0.86, 0.84];
const GOLD = [0.78, 0.56, 0.2];
const METAL = [0.66, 0.67, 0.69];

const b = readFileSync(SRC);
const nTri = b.readUInt32LE(80);
if (b.length !== 84 + nTri * 50) throw new Error('not a binary STL');

// Positions per corner, and the axis' centre (from the bounding box across the tube).
const P = new Float32Array(nTri * 9);
const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < nTri; i++)
  for (let v = 0; v < 3; v++)
    for (let a = 0; a < 3; a++) {
      const x = b.readFloatLE(84 + i * 50 + 12 + v * 12 + a * 4);
      P[i * 9 + v * 3 + a] = x;
      box.min[a] = Math.min(box.min[a]!, x);
      box.max[a] = Math.max(box.max[a]!, x);
    }
const cx = (box.min[0]! + box.max[0]!) / 2;
const cy = (box.min[1]! + box.max[1]!) / 2;
const z0 = box.min[2]!;
const lengthIn = box.max[2]! - z0;

// To metres, +Y along the tube (head up), centred on the axis.
for (let k = 0; k < P.length; k += 3) {
  const x = (P[k]! - cx) * INCH;
  const y = (P[k + 2]! - z0) * INCH;
  const z = -(P[k + 1]! - cy) * INCH;
  P[k] = x;
  P[k + 1] = y;
  P[k + 2] = z;
}

// Face normals, and faces around each position (welded at 1e-6 m).
const key = (k: number) =>
  `${Math.round(P[k]! * 1e6)},${Math.round(P[k + 1]! * 1e6)},${Math.round(P[k + 2]! * 1e6)}`;
const FN = new Float32Array(nTri * 3);
const around = new Map<string, number[]>();
for (let i = 0; i < nTri; i++) {
  const o = i * 9;
  const ux = P[o + 3]! - P[o]!;
  const uy = P[o + 4]! - P[o + 1]!;
  const uz = P[o + 5]! - P[o + 2]!;
  const vx = P[o + 6]! - P[o]!;
  const vy = P[o + 7]! - P[o + 1]!;
  const vz = P[o + 8]! - P[o + 2]!;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  FN.set([nx, ny, nz], i * 3);
  for (let v = 0; v < 3; v++) {
    const kk = key(o + v * 3);
    let list = around.get(kk);
    if (!list) around.set(kk, (list = []));
    list.push(i);
  }
}

/** The colour at a height along the tube (fraction from the closed end) and a radius (m). */
function colour(f: number, r: number): number[] {
  if (f < 0.055) return METAL; // the closed end's cap
  if (f < 0.08) return GOLD; // the thin ring above it
  if (f < 0.71) return WHITE; // the long, coated body and its taper
  if (f < 0.81) return GOLD; // the collar
  if (f < 0.955) return r > 0.0114 ? GOLD : WHITE; // the head: raised features gold
  return GOLD; // the crenellated rim
}

// Corners: smoothed normal (faces within the crease angle), colour; then welded by value.
const lengthM = lengthIn * INCH;
const index: number[] = [];
const outP: number[] = [];
const outN: number[] = [];
const outC: number[] = [];
const seen = new Map<string, number>();
for (let i = 0; i < nTri; i++) {
  const fx = FN[i * 3]!;
  const fy = FN[i * 3 + 1]!;
  const fz = FN[i * 3 + 2]!;
  // The face's colour from its centre (corners shared between bands keep one colour per face).
  const o = i * 9;
  const cyF = (P[o + 1]! + P[o + 4]! + P[o + 7]!) / 3;
  const rF =
    (Math.hypot(P[o]!, P[o + 2]!) + Math.hypot(P[o + 3]!, P[o + 5]!) + Math.hypot(P[o + 6]!, P[o + 8]!)) / 3;
  const c = colour(cyF / lengthM, rF);
  for (let v = 0; v < 3; v++) {
    const k = o + v * 3;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const j of around.get(key(k))!) {
      const gx = FN[j * 3]!;
      const gy = FN[j * 3 + 1]!;
      const gz = FN[j * 3 + 2]!;
      if (gx * fx + gy * fy + gz * fz < CREASE) continue;
      nx += gx;
      ny += gy;
      nz += gz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const id = `${key(k)}|${Math.round(nx * 100)},${Math.round(ny * 100)},${Math.round(nz * 100)}|${c.join()}`;
    let at = seen.get(id);
    if (at === undefined) {
      at = outP.length / 3;
      seen.set(id, at);
      outP.push(P[k]!, P[k + 1]!, P[k + 2]!);
      outN.push(nx, ny, nz);
      outC.push(...c);
    }
    index.push(at);
  }
}

// A minimal GLB: one mesh, positions, normals, vertex colours, 32-bit indices.
const pos = new Float32Array(outP);
const nrm = new Float32Array(outN);
const col = new Float32Array(outC);
const idx = new Uint32Array(index);
const views = [pos, nrm, col, idx];
const offsets: number[] = [];
let len = 0;
for (const v of views) {
  offsets.push(len);
  len += v.byteLength;
}
const bin = Buffer.alloc(len);
views.forEach((v, i) => Buffer.from(v.buffer).copy(bin, offsets[i]));
const pmin = [0, 1, 2].map((a) => Math.min(...outP.filter((_, i) => i % 3 === a)));
const pmax = [0, 1, 2].map((a) => Math.max(...outP.filter((_, i) => i % 3 === a)));
const nV = pos.length / 3;
const json = {
  asset: { version: '2.0', generator: 'Copernico build-sample-tube.ts', copyright: 'NASA/JPL-Caltech' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'sample-tube', mesh: 0 }],
  meshes: [
    {
      name: 'Mars 2020 sample tube',
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }],
    },
  ],
  materials: [{ name: 'tube', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.35, roughnessFactor: 0.4 } }],
  buffers: [{ byteLength: len }],
  bufferViews: views.map((v, i) => ({
    buffer: 0,
    byteOffset: offsets[i],
    byteLength: v.byteLength,
    target: i === 3 ? 34963 : 34962,
  })),
  accessors: [
    { bufferView: 0, componentType: 5126, count: nV, type: 'VEC3', min: pmin, max: pmax },
    { bufferView: 1, componentType: 5126, count: nV, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: nV, type: 'VEC3' },
    { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
  ],
};
const pad = (buf: Buffer, fill: number) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, fill)]);
const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20);
const binBuf = pad(bin, 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
const chunk = (type: number, data: Buffer) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(RAW_OUT, Buffer.concat([header, chunk(0x4e4f534a, jsonBuf), chunk(0x004e4942, binBuf)]));
console.log(
  `sample tube: ${nTri} triangles, ${nV} vertices, ${(lengthM * 100).toFixed(1)} cm long, ` +
    `${((box.max[0]! - box.min[0]!) * INCH * 100).toFixed(2)} cm across → ${RAW_OUT}`,
);
console.log(
  'then: npx -y @gltf-transform/cli@4 optimize data/build/models/sample-tube.raw.glb data/build/models/sample-tube.glb --compress meshopt',
);
