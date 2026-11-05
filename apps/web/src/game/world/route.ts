import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector3,
} from 'three';

/**
 * AutoNav's planned path, draped on the ground: a band of chevrons flowing towards the goal, as
 * the rover's path planner shows its route to the drivers. Points are local (x east, north).
 */
export class RouteLine {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private geometry = new BufferGeometry();
  /** Path samples (local x, north, distance along) and the one nearest the rover. */
  private samples: Array<[number, number, number]> = [];
  private nearest = 0;

  constructor() {
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(0.35, 0.85, 1.0) },
        uLength: { value: 1 },
        uDone: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float along;
        attribute float side;
        varying float vAlong;
        varying float vSide;
        varying float vDist;
        void main() {
          vAlong = along;
          vSide = side;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDist = length(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uLength, uDone;
        uniform vec3 uColor;
        varying float vAlong;
        varying float vSide;
        varying float vDist;
        void main() {
          // Chevrons every 3 m pointing along the path, flowing forward.
          float s = fract((vAlong - uTime * 4.0) / 3.0 - abs(vSide) * 0.35);
          float chevron = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.32, 0.42, s));
          float edge = 1.0 - smoothstep(0.75, 1.0, abs(vSide));
          // Fades near the rover (it is under the camera) and far away, and at the very end.
          // The part already driven is gone; it fades in just ahead of the rover.
          float near = smoothstep(uDone + 2.0, uDone + 7.0, vAlong);
          float far = 1.0 - smoothstep(140.0, 260.0, vDist);
          float end = 1.0 - smoothstep(uLength - 4.0, uLength, vAlong);
          float a = chevron * edge * near * far * (0.35 + 0.65 * end) * 0.45;
          gl_FragColor = vec4(uColor * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** Draws the path (local points), sampled every 0.5 m and lifted just above the ground. */
  set(points: Array<[number, number]> | null, groundY: (x: number, z: number) => number): void {
    this.geometry.dispose();
    this.geometry = new BufferGeometry();
    this.mesh.geometry = this.geometry;
    if (!points || points.length < 2) {
      this.mesh.visible = false;
      return;
    }
    const samples: Array<[number, number, number]> = [];
    this.samples = samples;
    this.nearest = 0;
    let along = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, an] = points[i - 1]!;
      const [bx, bn] = points[i]!;
      const d = Math.hypot(bx - ax, bn - an);
      const n = Math.max(1, Math.ceil(d / 0.5));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const t = k / n;
        samples.push([ax + (bx - ax) * t, an + (bn - an) * t, along + d * t]);
      }
      along += d;
    }
    // A narrow guide (a wide band read as a ribbon laid over the terrain).
    const half = 0.25;
    const pos = new Float32Array(samples.length * 2 * 3);
    const al = new Float32Array(samples.length * 2);
    const side = new Float32Array(samples.length * 2);
    const index: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      const [x, n, a] = samples[i]!;
      const [px, pn] = samples[Math.max(0, i - 1)]!;
      const [qx, qn] = samples[Math.min(samples.length - 1, i + 1)]!;
      let dx = qx - px;
      let dn = qn - pn;
      const l = Math.hypot(dx, dn) || 1;
      dx /= l;
      dn /= l;
      for (let k = 0; k < 2; k++) {
        const s = k === 0 ? -1 : 1;
        // Right of the direction of travel: (dn, −dx) in (x, north).
        const vx = x + dn * half * s;
        const vn = n - dx * half * s;
        pos.set([vx, groundY(vx, -vn) + 0.08, -vn], (i * 2 + k) * 3);
        al[i * 2 + k] = a;
        side[i * 2 + k] = s;
      }
      if (i < samples.length - 1)
        index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.geometry.setAttribute('position', new BufferAttribute(pos, 3));
    this.geometry.setAttribute('along', new BufferAttribute(al, 1));
    this.geometry.setAttribute('side', new BufferAttribute(side, 1));
    this.geometry.setIndex(index);
    (this.material.uniforms.uLength as { value: number }).value = along;
    this.mesh.visible = true;
  }

  /** Animates the chevrons and hides the path behind the rover (local x, north). */
  update(time: number, roverX: number, roverNorth: number): void {
    const s = this.samples;
    if (this.mesh.visible && s.length) {
      // The path is driven in order: search a little way on from the last nearest sample.
      let best = this.nearest;
      let bestD = Infinity;
      for (let i = this.nearest; i < Math.min(s.length, this.nearest + 400); i++) {
        const d = (s[i]![0] - roverX) ** 2 + (s[i]![1] - roverNorth) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      this.nearest = best;
      (this.material.uniforms.uDone as { value: number }).value = s[best]![2];
    }
    (this.material.uniforms.uTime as { value: number }).value = time;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Sample tubes left on the ground at the depot (titanium, ~17 cm long with the cap), in a line
 * behind the rover a few metres apart, as at Three Forks.
 */
export class DepotTubes {
  readonly group = new Group();
  private readonly geometry = new CylinderGeometry(0.012, 0.012, 0.17, 10);
  private readonly material = new MeshStandardMaterial({
    color: new Color(0.82, 0.8, 0.76),
    metalness: 0.85,
    roughness: 0.28,
  });

  /** Lays `count` tubes from `origin` along `dir` (world, horizontal), `spacingM` apart. */
  lay(
    count: number,
    origin: Vector3,
    dir: Vector3,
    spacingM: number,
    groundY: (x: number, z: number) => number,
  ): void {
    this.clear();
    const side = new Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < count; i++) {
      const m = new Mesh(this.geometry, this.material);
      // A gentle zig-zag, so no tube lies in another's track.
      const off = (i % 2 ? 1 : -1) * 1.6;
      const x = origin.x + dir.x * spacingM * (i + 1) + side.x * off;
      const z = origin.z + dir.z * spacingM * (i + 1) + side.z * off;
      m.position.set(x, groundY(x, z) + 0.012, z);
      m.rotation.set(0, Math.random() * Math.PI, Math.PI / 2);
      m.castShadow = true;
      this.group.add(m);
    }
  }

  clear(): void {
    this.group.clear();
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}
