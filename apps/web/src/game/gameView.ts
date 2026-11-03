import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ArcType,
  ConstantProperty,
  Entity,
  HeadingPitchRoll,
  ImageBasedLighting,
  Matrix4,
  Model,
  PolylineGlowMaterialProperty,
  ShadowMode,
  Transforms,
} from 'cesium';
import { follow, wrapAngle } from '../lib/math';
import { MARS_SPHERE, type MarsScene } from '../render/marsScene';
import type { Target } from './missions';
import { offsetPoint, type GroundProbe, type RoverState } from './roverSim';

export type CameraMode = 'chase' | 'far' | 'top';

/** Distance behind the aim point (m) and elevation angle (°) per camera mode. */
const CAMERA: Record<CameraMode, { distM: number; elevDeg: number }> = {
  chase: { distM: 16, elevDeg: 22 },
  far: { distM: 38, elevDeg: 30 },
  top: { distM: 150, elevDeg: 68 },
};
/** The camera aims a little above the rover's deck. */
const AIM_UP_M = 1.6;
const CAMERA_CLEARANCE_M = 2;
const BEACON_M = 90;
const RING_POINTS = 48;

const COLOURS = {
  open: Color.fromCssColorString('#ffb45a'),
  depot: Color.fromCssColorString('#7fd6ff'),
  done: Color.fromCssColorString('#6be39a'),
};

/**
 * Everything the rover game draws in the Cesium scene: the Perseverance glTF placed every frame on
 * the terrain, a light column and a ground ring per target, and the chase camera.
 */
export class GameView {
  private model: Model | null = null;
  private turret: { node: { matrix: Matrix4; originalMatrix: Matrix4 } } | null = null;
  private readonly modelMatrix = new Matrix4();
  private readonly hpr = new HeadingPitchRoll();
  private readonly scratch = new Cartographic();
  private readonly entities = new Map<string, Entity[]>();
  private readonly bases = new Map<string, { lat: number; lon: number; heightM: number }>();
  private camHeading = 0;
  private camHeightM = Number.NaN;
  private yawOffset = 0;
  private elevOffsetDeg = 0;
  private zoom = 1;
  private dragging = false;
  mode: CameraMode = 'chase';

  readonly ground: GroundProbe;

  constructor(private readonly scene: MarsScene) {
    const globe = scene.widget.scene.globe;
    this.ground = {
      height: (lat, lon) => globe.getHeight(Cartographic.fromDegrees(lon, lat, 0, this.scratch)),
    };
    // Real shadows for the rover (it otherwise seems to float over the orbital imagery), cast by
    // the scene's sun; the terrain only receives them. Kept within 300 m for resolution.
    globe.shadows = ShadowMode.RECEIVE_ONLY;
    const shadowMap = scene.widget.scene.shadowMap;
    shadowMap.enabled = true;
    shadowMap.softShadows = true;
    shadowMap.size = 2048;
    shadowMap.maximumDistance = 300;
    shadowMap.darkness = 0.45;
    this.installCameraInput();
  }

  // ---------- rover model ----------

  async loadRover(url: string): Promise<boolean> {
    try {
      const lighting = new ImageBasedLighting();
      // Same look as the planner's close-up: warm sun, little of Cesium's Earth-sky reflections.
      lighting.imageBasedLightingFactor = new Cartesian2(0.5, 0.35);
      const model = await Model.fromGltfAsync({
        url,
        modelMatrix: this.modelMatrix,
        shadows: ShadowMode.ENABLED,
        lightColor: new Cartesian3(3.1, 2.85, 2.55),
        imageBasedLighting: lighting,
      });
      if (this.scene.isDestroyed()) {
        model.destroy();
        return false;
      }
      this.scene.widget.scene.primitives.add(model);
      this.model = model;
      model.readyEvent.addEventListener(() => {
        const node = model.getNode('turret_obj');
        if (node) this.turret = { node };
      });
      return true;
    } catch {
      return false;
    }
  }

  placeRover(s: RoverState, coringFraction: number | null, timeS: number): void {
    const position = Cartesian3.fromDegrees(s.lon, s.lat, s.heightM, MARS_SPHERE);
    // The model's front is glTF +Z, which Cesium turns to face east at heading 0: hence −90°.
    this.hpr.heading = s.headingRad - Math.PI / 2;
    this.hpr.pitch = s.pitchRad;
    this.hpr.roll = s.rollRad;
    Transforms.headingPitchRollToFixedFrame(
      position,
      this.hpr,
      MARS_SPHERE,
      undefined,
      this.modelMatrix,
    );
    if (this.model) this.model.modelMatrix = this.modelMatrix;
    // Coring: the arm's turret (drill) shakes with the percussion.
    if (this.turret) {
      const { node } = this.turret;
      if (coringFraction === null) {
        node.matrix = node.originalMatrix;
      } else {
        const j = 0.012 * Math.sin(timeS * 90);
        node.matrix = Matrix4.multiplyByTranslation(
          node.originalMatrix,
          new Cartesian3(j, -0.008 * Math.abs(Math.sin(timeS * 45)), j),
          new Matrix4(),
        );
      }
    }
  }

  // ---------- targets ----------

  /** A light column (seen from afar) and a ring on the ground (the zone to stop in) per target. */
  async setTargets(targets: Array<Target & { heightM: number }>): Promise<void> {
    this.clearTargets();
    // Ring heights from the most detailed terrain, in one query (draped 0.3 m above it).
    const rings = targets.map((t) => circle(t, t.radiusM, RING_POINTS));
    const heights = await this.scene.sampleTerrain(rings.flat());
    if (this.scene.isDestroyed()) return;
    for (const [i, t] of targets.entries()) {
      const ringPositions = rings[i]!.map((p, k) => {
        const h = heights[i * (RING_POINTS + 1) + k];
        return Cartesian3.fromDegrees(
          p.lon,
          p.lat,
          (Number.isFinite(h) ? h! : t.heightM) + 0.3,
          MARS_SPHERE,
        );
      });
      const colour = t.kind === 'depot' ? COLOURS.depot : COLOURS.open;
      // A glowing vertical line: a constant width on screen, so it reads from kilometres away.
      const beam = new Entity({
        id: `game:${t.id}:beam`,
        polyline: {
          positions: this.beamPositions(t, BEACON_M),
          width: 14,
          arcType: ArcType.NONE,
          material: new PolylineGlowMaterialProperty({
            color: colour,
            glowPower: 0.3,
            taperPower: 0.6,
          }),
        },
      });
      const ring = new Entity({
        id: `game:${t.id}:ring`,
        polyline: {
          positions: ringPositions,
          width: 5,
          arcType: ArcType.NONE,
          material: colour.withAlpha(0.95),
          depthFailMaterial: colour.withAlpha(0.35),
        },
      });
      const disc = new Entity({
        id: `game:${t.id}:disc`,
        position: Cartesian3.fromDegrees(t.lon, t.lat, 0, MARS_SPHERE),
        ellipse: {
          semiMajorAxis: t.radiusM,
          semiMinorAxis: t.radiusM,
          material: colour.withAlpha(0.16),
        },
      });
      const list = [beam, ring, disc];
      this.bases.set(t.id, { lat: t.lat, lon: t.lon, heightM: t.heightM });
      for (const e of list) this.scene.widget.entities.add(e);
      this.entities.set(t.id, list);
    }
    this.scene.requestRender();
  }

  markDone(targetId: string): void {
    const [beam, ring, disc] = this.entities.get(targetId) ?? [];
    const base = this.bases.get(targetId);
    if (beam?.polyline && base) {
      beam.polyline.positions = new ConstantProperty(this.beamPositions(base, BEACON_M / 4));
      beam.polyline.material = new PolylineGlowMaterialProperty({
        color: COLOURS.done.withAlpha(0.7),
        glowPower: 0.3,
        taperPower: 0.6,
      });
    }
    if (ring?.polyline)
      ring.polyline.material = new ColorMaterialProperty(COLOURS.done.withAlpha(0.6));
    if (disc) disc.show = false;
    this.scene.requestRender();
  }

  private beamPositions(t: { lat: number; lon: number; heightM: number }, lengthM: number) {
    return [
      Cartesian3.fromDegrees(t.lon, t.lat, t.heightM, MARS_SPHERE),
      Cartesian3.fromDegrees(t.lon, t.lat, t.heightM + lengthM, MARS_SPHERE),
    ];
  }

  clearTargets(): void {
    for (const list of this.entities.values())
      for (const e of list) this.scene.widget.entities.remove(e);
    this.entities.clear();
  }

  // ---------- camera ----------

  cycleCamera(): CameraMode {
    const order: CameraMode[] = ['chase', 'far', 'top'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length]!;
    return this.mode;
  }

  /** Heading the camera looks along (for the HUD's direction arrow and the mini-map cone). */
  get cameraHeadingRad(): number {
    return this.camHeading;
  }

  /** Turns the view around the rover (the menu's slow orbit). */
  orbit(rad: number): void {
    this.yawOffset += rad;
  }

  /** Puts the camera behind the rover at once (mission start). */
  snapCamera(s: RoverState): void {
    this.camHeading = s.headingRad;
    this.camHeightM = Number.NaN;
    this.yawOffset = 0;
    this.updateCamera(s, 1);
  }

  /** Chase camera: follows the rover's heading with smoothing, never below the terrain. */
  updateCamera(s: RoverState, dt: number): void {
    const cam = CAMERA[this.mode];
    // After the player looks around, the view swings back behind the rover once it drives.
    if (!this.dragging && Math.abs(s.speed) > 0.5) {
      this.yawOffset *= 1 - follow(dt, 1.2);
      this.elevOffsetDeg *= 1 - follow(dt, 1.6);
    }
    const wanted = s.headingRad + this.yawOffset;
    this.camHeading +=
      wrapAngle(wanted - this.camHeading) * follow(dt, this.dragging ? 0.05 : 0.35);
    const elev = ((cam.elevDeg + this.elevOffsetDeg) * Math.PI) / 180;
    const dist = cam.distM * this.zoom;
    const horizontal = dist * Math.cos(elev);
    const aimH = s.heightM + AIM_UP_M;
    const at = offsetPoint(s.lat, s.lon, this.camHeading, -horizontal, 0);
    const floor = (this.ground.height(at.lat, at.lon) ?? s.heightM) + CAMERA_CLEARANCE_M;
    const wantedH = Math.max(aimH + dist * Math.sin(elev), floor);
    this.camHeightM = Number.isFinite(this.camHeightM)
      ? Math.max(floor, this.camHeightM + (wantedH - this.camHeightM) * follow(dt, 0.18))
      : wantedH;
    const pitch = -Math.atan2(this.camHeightM - aimH, horizontal);
    this.scene.widget.camera.setView({
      destination: Cartesian3.fromDegrees(at.lon, at.lat, this.camHeightM, MARS_SPHERE),
      orientation: { heading: this.camHeading, pitch, roll: 0 },
    });
  }

  /** Drag to look around the rover, wheel to zoom. */
  private installCameraInput(): void {
    const canvas = this.scene.widget.scene.canvas;
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
      this.elevOffsetDeg = Math.max(
        -10,
        Math.min(45, this.elevOffsetDeg + (e.clientY - last.y) * 0.15),
      );
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
        this.zoom = Math.max(0.6, Math.min(2.6, this.zoom * Math.exp(e.deltaY * 0.001)));
      },
      { passive: false },
    );
  }
}

/** Closed ring of n + 1 ground points around a target. */
function circle(
  c: { lat: number; lon: number },
  radiusM: number,
  n: number,
): Array<{ lat: number; lon: number }> {
  return Array.from({ length: n + 1 }, (_, i) =>
    offsetPoint(c.lat, c.lon, (2 * Math.PI * i) / n, radiusM, 0),
  );
}
