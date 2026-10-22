import { greatCircleDistance } from '@copernico/domain';
import {
  Cartesian3,
  Cartographic,
  type Ellipsoid,
  Math as CesiumMath,
  Matrix4,
  Transforms,
} from 'cesium';

/** Climb per metre of ground covered, before subtracting what the height change already gives. */
const HOP_PER_M = 0.18;
const MIN_SECONDS = 1.2;
/** Trips at least this long (straight-line metres) take the full requested duration. */
const FULL_DURATION_M = 12_000;

/**
 * `maximumHeight` for camera.flyTo / flyToBoundingSphere. Cesium uses it as the peak of the flight
 * itself, and its own default assumes heights above the reference surface (Jezero lies ~2.5 km
 * below Mars's), so without this every flight climbs and comes back down. Here a flight rises by a
 * fraction of the ground it covers, less what the height change already gives: a nearby place is a
 * direct glide from where the camera is, a distant one a gentle hop, orbit to surface a plain
 * descent. Returning the higher endpoint means no climb at all.
 */
export function flightPeak(from: Cartesian3, to: Cartesian3, ellipsoid: Ellipsoid): number {
  const a = Cartographic.fromCartesian(from, ellipsoid);
  const b = Cartographic.fromCartesian(to, ellipsoid);
  if (!a || !b) return 0;
  const deg = (c: Cartographic) => ({
    lat: CesiumMath.toDegrees(c.latitude),
    lon: CesiumMath.toDegrees(c.longitude),
  });
  const ground = greatCircleDistance(deg(a), deg(b), ellipsoid.maximumRadius);
  const hop = Math.max(0, HOP_PER_M * ground - 0.5 * Math.abs(a.height - b.height));
  return Math.max(a.height, b.height) + hop;
}

/** Shorter flights for short trips (a few hundred metres take ~1.2 s), up to `maxSeconds`. */
export function flightSeconds(from: Cartesian3, to: Cartesian3, maxSeconds: number): number {
  const f = Math.min(1, Cartesian3.distance(from, to) / FULL_DURATION_M);
  return Math.min(maxSeconds, MIN_SECONDS + (maxSeconds - MIN_SECONDS) * f);
}

/**
 * Camera position that looks at `target` with a heading (from north, clockwise) and pitch
 * (negative looks down) from `range` metres, as flyToBoundingSphere's offset places it.
 */
export function viewpoint(
  target: Cartesian3,
  heading: number,
  pitch: number,
  range: number,
  ellipsoid: Ellipsoid,
): Cartesian3 {
  const enu = Transforms.eastNorthUpToFixedFrame(target, ellipsoid);
  const horizontal = range * Math.cos(pitch);
  const local = new Cartesian3(
    -horizontal * Math.sin(heading),
    -horizontal * Math.cos(heading),
    -range * Math.sin(pitch),
  );
  return Matrix4.multiplyByPoint(enu, local, new Cartesian3());
}
