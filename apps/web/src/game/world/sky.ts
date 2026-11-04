import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * Daytime Mars sky. Colours: the horizon and +15° tones sampled from the Mastcam-Z panorama
 * PIA26699 (as the planner's sky), the zenith extrapolated; around the Sun the bluish aureole
 * that Mars's fine dust produces (forward scattering, seen in rover images), plus a warm glow.
 * Values are scene-linear and pass through the renderer's tone mapping.
 *
 * Also the brighter band of dust just above the horizon. The glow on the Sun's side is wide and
 * strong, as in the Wildcat Ridge panorama (the sky near the horizon there goes from cream on the
 * Sun's side to orange-tan away from it).
 */
const HORIZON = new Color().setRGB(0.87, 0.68, 0.49, SRGBColorSpace);
const SKY_15 = new Color().setRGB(0.69, 0.55, 0.4, SRGBColorSpace);
const ZENITH = new Color().setRGB(0.45, 0.36, 0.27, SRGBColorSpace);
export const HORIZON_LINEAR = HORIZON.clone();

/** World direction (x east, y up, z south) of the Sun at a compass azimuth and elevation (°). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const a = (azimuthDeg * Math.PI) / 180;
  const e = (elevationDeg * Math.PI) / 180;
  return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

export class SkyDome {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(sun: Vector3, brightness = 1.15) {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uSun: { value: sun.clone().normalize() },
        uHorizon: {
          value: new Vector3(HORIZON.r, HORIZON.g, HORIZON.b).multiplyScalar(brightness),
        },
        u15: { value: new Vector3(SKY_15.r, SKY_15.g, SKY_15.b).multiplyScalar(brightness) },
        uZenith: { value: new Vector3(ZENITH.r, ZENITH.g, ZENITH.b).multiplyScalar(brightness) },
        uStorm: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 1000.0, 1.0);
          gl_Position = p.xyww; // on the far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun, uHorizon, u15, uZenith;
        uniform float uStorm;
        varying vec3 vDir;

        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -1.0, 1.0);
          vec3 sky = mix(uHorizon, u15, smoothstep(0.0, 0.27, h));
          sky = mix(sky, uZenith, smoothstep(0.27, 1.0, h));
          // A little brighter towards the Sun's side of the sky.
          float c = dot(d, uSun);
          float side = 0.5 + 0.5 * c;
          sky *= 0.9 + 0.22 * side;
          // Bluish aureole close to the Sun, then a broad warm forward-scattering glow.
          float near = pow(max(c, 0.0), 90.0);
          float broad = pow(max(c, 0.0), 7.0);
          float clear = 1.0 - uStorm;
          float wide = 0.15 * pow(max(c, 0.0), 3.0) + 0.25 * broad;
          // Brightest low over the horizon on the Sun's side, where the light crosses most dust.
          float sunSide = pow(0.5 + 0.5 * dot(normalize(d.xz + vec2(1e-5)), normalize(uSun.xz)), 3.0);
          float low = exp(-max(h, 0.0) * 4.0);
          sky += (vec3(0.42, 0.52, 0.70) * near * 1.6 + vec3(1.0, 0.86, 0.64) * wide
                  + vec3(1.0, 0.92, 0.72) * 0.42 * sunSide * low) * clear;
          // Solar disc (0.35°: the Sun is smaller from Mars), soft-edged and very bright.
          float disc = smoothstep(0.999978, 0.999988, c);
          sky += vec3(1.0, 0.97, 0.92) * disc * 40.0 * clear * clear;
          // A brighter band of dust just above the horizon.
          sky += uHorizon * 0.1 * exp(-h * h * 900.0) * clear;
          // Below the horizon (seen only past distant terrain): the haze colour.
          sky = h < 0.0 ? uHorizon * (1.0 + 0.3 * h) : sky;
          // Dust storm: an even, dim, ruddy sky (the Sun a pale glow).
          vec3 dust = uHorizon * vec3(0.62, 0.47, 0.34) + vec3(0.25, 0.18, 0.12) * broad;
          sky = mix(sky, dust, uStorm);
          gl_FragColor = vec4(sky, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Pre-filtered environment of this sky, for image-based lighting (ambient and reflections). */
  environment(renderer: WebGLRenderer): Texture {
    const scene = new Scene();
    const dome = new Mesh(this.mesh.geometry, this.material.clone());
    // No solar disc in the environment: it would make specular highlights double the sun light.
    (dome.material as ShaderMaterial).fragmentShader = (
      dome.material as ShaderMaterial
    ).fragmentShader.replace('sky += vec3(1.0, 0.97, 0.92) * disc * 40.0 * clear * clear;', '');
    scene.add(dome);
    const pmrem = new PMREMGenerator(renderer);
    const target = pmrem.fromScene(scene, 0, 0.1, 100);
    pmrem.dispose();
    (dome.material as ShaderMaterial).dispose();
    return target.texture;
  }

  setStorm(s: number): void {
    this.material.uniforms.uStorm!.value = s;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
