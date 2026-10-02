import { Cartesian3, Cartographic, Math as CesiumMath, type Scene } from 'cesium';
import { greatCircleDistance, MARS_SPHERE_RADIUS_M, normalizeLon180 } from '@copernico/domain';

/**
 * The controlled exploration volume. Close-up flight is allowed only over Jezero; elsewhere the
 * minimum altitude rises smoothly (a "funnel"), so the camera is pushed up instead of passing into
 * areas without detailed data. A maximum altitude keeps Mars in view.
 */
export interface ExplorationZone {
  /** Zone centre (planetocentric °N, °E): Jezero crater centre (USGS Gazetteer). */
  lat: number;
  lon: number;
  /** Ground distance within which the camera may descend to `minAboveTerrainM` (m). */
  innerRadiusM: number;
  /** Ground distance beyond which the altitude floor is `minAltitudeOutsideM` (m). */
  outerRadiusM: number;
  /** Minimum clearance above the rendered terrain inside the inner radius (m). */
  minAboveTerrainM: number;
  /** Minimum altitude above the reference sphere far from Jezero (m). */
  minAltitudeOutsideM: number;
  /** Maximum altitude above the reference sphere (m). */
  maxAltitudeM: number;
}

export const JEZERO_ZONE: ExplorationZone = {
  lat: 18.41,
  lon: 77.69,
  innerRadiusM: 32_000,
  outerRadiusM: 450_000,
  minAboveTerrainM: 220,
  minAltitudeOutsideM: 160_000,
  maxAltitudeM: 24_000_000,
};

/** Terrain floor assumed when the terrain height below the camera is not yet known (Jezero rim top). */
const UNKNOWN_TERRAIN_M = -1_700;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * A spot where the camera may come down close to the ground (e.g. around the 3D rover model):
 * within `radiusM` the clearance is `minAboveTerrainM`, blending back to the zone clearance by 2×.
 */
export interface CloseUpSpot {
  lat: number;
  lon: number;
  radiusM: number;
  minAboveTerrainM: number;
}

/** Clearance above terrain (m) at a point, given the close-up spots and their distances. */
export function clearanceAt(
  zone: ExplorationZone,
  spots: ReadonlyArray<CloseUpSpot & { distanceM: number }>,
): number {
  let c = zone.minAboveTerrainM;
  for (const s of spots) {
    const k = smoothstep(s.radiusM, 2 * s.radiusM, s.distanceM);
    c = Math.min(c, s.minAboveTerrainM + (zone.minAboveTerrainM - s.minAboveTerrainM) * k);
  }
  return c;
}

/** Lowest allowed camera altitude (m above the reference sphere) at a ground distance from the zone. */
export function altitudeFloor(
  zone: ExplorationZone,
  groundDistanceM: number,
  terrainHeightM: number,
  clearanceM = zone.minAboveTerrainM,
): number {
  const nearFloor = terrainHeightM + clearanceM;
  const blend = smoothstep(zone.innerRadiusM, zone.outerRadiusM, groundDistanceM);
  return nearFloor + (zone.minAltitudeOutsideM - nearFloor) * blend;
}

/**
 * Installs the constraints on a scene. Returns a function to suspend them (e.g. during scripted
 * flights, which follow their own safe paths) and a disposer.
 */
export function installCameraConstraints(scene: Scene, zone: ExplorationZone = JEZERO_ZONE) {
  const controller = scene.screenSpaceCameraController;
  controller.minimumZoomDistance = zone.minAboveTerrainM;
  controller.maximumZoomDistance = zone.maxAltitudeM;
  controller.enableLook = false; // no free-look into empty space
  controller.enableCollisionDetection = true;

  let suspended = false;
  const scratch = new Cartographic();
  const spots: CloseUpSpot[] = [];

  const enforce = () => {
    const camera = scene.camera;
    const carto = Cartographic.fromCartesian(camera.positionWC, scene.globe.ellipsoid, scratch);
    if (!carto) return;
    const lat = CesiumMath.toDegrees(carto.latitude);
    const lon = CesiumMath.toDegrees(carto.longitude);
    const clearance = clearanceAt(
      zone,
      spots.map((s) => ({
        ...s,
        distanceM: greatCircleDistance({ lat, lon }, { lat: s.lat, lon: normalizeLon180(s.lon) }),
      })),
    );
    // Cesium's own collision check (which runs before this, every frame) uses this value too: keep
    // it current even during scripted flights, or it lifts the camera right after a close-up flight.
    controller.minimumZoomDistance = clearance;
    if (suspended) return;
    const distance = greatCircleDistance(
      { lat, lon },
      { lat: zone.lat, lon: normalizeLon180(zone.lon) },
    );
    const terrain = distance < zone.outerRadiusM ? scene.globe.getHeight(carto) : undefined;
    const floor = altitudeFloor(zone, distance, terrain ?? UNKNOWN_TERRAIN_M, clearance);
    const target = Math.min(zone.maxAltitudeM, Math.max(floor, carto.height));
    if (Math.abs(target - carto.height) < 0.5) return;
    // Keep the view direction; only the altitude is limited (blocks the move instead of passing through).
    const { heading, pitch, roll } = camera;
    camera.setView({
      destination: Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        target,
        scene.globe.ellipsoid,
      ),
      orientation: { heading, pitch, roll },
    });
  };
  scene.preRender.addEventListener(enforce);

  return {
    suspend(value: boolean) {
      suspended = value;
    },
    addCloseUp(spot: CloseUpSpot) {
      spots.push(spot);
    },
    dispose() {
      scene.preRender.removeEventListener(enforce);
    },
  };
}

/** Altitude of the reference sphere in metres, for reference in docs/tests. */
export const REFERENCE_RADIUS_M = MARS_SPHERE_RADIUS_M;
