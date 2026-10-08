import { Cartesian2, Cartesian3, Ray, type Scene } from 'cesium';
import { MARS_SPHERE_RADIUS_M, normalizeLon180 } from '@copernico/domain';

/**
 * Screen-space annotations rendered as DOM chips over the globe, so text is always crisp and never
 * overlaps: every frame, labels are projected, hidden when behind Mars, and placed greedily by
 * priority, trying four positions around the anchor before hiding a label.
 *
 * Places (POIs, the rover, panoramas) are pins: a dot exactly on the ground, a thin stem, and the
 * label above at one of a few stem heights. The dot replaces a WebGL point, which terrain clips into
 * a half-buried dome; dots stay visible when their label has no room.
 */
export type AnnotationKind = 'waypoint' | 'poi' | 'rover' | 'region' | 'panorama';

export interface Annotation {
  id: string;
  lat: number;
  lon: number;
  heightM: number;
  text: string;
  kind: AnnotationKind;
  /** Higher wins when labels would overlap. */
  priority: number;
  /** Annotations sharing a key are shown once (the highest priority wins), e.g. a POI used as a waypoint. */
  dedupeKey?: string;
  /** Short badge text (e.g. waypoint number). */
  badge?: string;
  /** Makes the label a button (e.g. open a panorama). */
  onClick?: () => void;
  /** A small action inside the label (e.g. "360°" opens the panorama taken there). */
  chip?: { text: string; onClick: () => void };
  /** Visible only when the camera is closer / farther than these distances (m). */
  maxCameraDistanceM?: number;
  minCameraDistanceM?: number;
}

interface Placed {
  el: HTMLElement;
  /** Pins only. */
  stem?: HTMLElement;
  dot?: HTMLElement;
  anchor: Cartesian3;
  a: Annotation;
  width: number;
  height: number;
}

const PIN_KINDS: ReadonlySet<AnnotationKind> = new Set(['poi', 'rover', 'panorama']);
/** Stem lengths tried in turn (px), so nearby pins stagger instead of hiding their labels. */
const STEMS = [16, 38, 60, 84] as const;
const DOT_PX = 10;

const OFFSETS: ReadonlyArray<readonly [number, number, string]> = [
  [0, -14, 'above'],
  [14, 0, 'right'],
  [-14, 0, 'left'],
  [0, 14, 'below'],
];

// Occluding sphere slightly inside the reference sphere so surface points ~2.5 km below it stay visible.
const OCCLUSION_MS = 150;
const OCCLUDER_RADIUS_M = MARS_SPHERE_RADIUS_M - 12_000;

/** True if the straight line from the camera to the point passes through the occluding sphere. */
export function isBehindPlanet(
  camera: Cartesian3,
  point: Cartesian3,
  radius = OCCLUDER_RADIUS_M,
): boolean {
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const dz = point.z - camera.z;
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return false;
  const [ux, uy, uz] = [dx / length, dy / length, dz / length];
  const b = camera.x * ux + camera.y * uy + camera.z * uz;
  const c = camera.x ** 2 + camera.y ** 2 + camera.z ** 2 - radius * radius;
  const disc = b * b - c;
  if (disc <= 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < length;
}

export class AnnotationLayer {
  readonly root: HTMLDivElement;
  private groups = new Map<string, Placed[]>();
  private hidden = new Set<string>();
  private muted = new Set<string>();
  private scratch = new Cartesian2();
  /** Terrain-occlusion results per label, refreshed at most every OCCLUSION_MS. */
  private occluded = new Map<HTMLElement, boolean>();
  private occlusionAt = 0;
  private refreshQueued = false;

  constructor(
    container: HTMLElement,
    private readonly scene: Scene,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'annotations';
    this.root.setAttribute('aria-hidden', 'true'); // panels provide the accessible equivalent
    container.appendChild(this.root);
  }

  set(group: string, items: Annotation[]): void {
    for (const p of this.groups.get(group) ?? []) {
      p.el.remove();
      p.stem?.remove();
      p.dot?.remove();
    }
    const placed = items.map((a): Placed => {
      let stem: HTMLElement | undefined;
      let dot: HTMLElement | undefined;
      if (PIN_KINDS.has(a.kind)) {
        stem = document.createElement('div');
        stem.className = 'annotation-stem';
        dot = document.createElement('div');
        dot.className = `annotation-dot annotation-dot-${a.kind}`;
        if (a.onClick) {
          dot.classList.add('annotation-action');
          dot.addEventListener('click', a.onClick);
        }
        this.root.append(stem, dot);
      }
      const el = document.createElement('div');
      el.className = `annotation annotation-${a.kind}`;
      if (a.badge) {
        const b = document.createElement('span');
        b.className = 'annotation-badge';
        b.textContent = a.badge;
        el.appendChild(b);
      }
      if (a.onClick) {
        el.classList.add('annotation-action');
        el.addEventListener('click', a.onClick);
      }
      const t = document.createElement('span');
      t.className = 'annotation-text';
      t.textContent = a.text;
      el.appendChild(t);
      if (a.chip) {
        const chip = document.createElement('span');
        chip.className = 'annotation-chip';
        chip.textContent = a.chip.text;
        const action = a.chip.onClick;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          action();
        });
        el.classList.add('annotation-action');
        el.appendChild(chip);
      }
      this.root.appendChild(el);
      return {
        el,
        ...(stem && dot ? { stem, dot } : {}),
        a,
        anchor: Cartesian3.fromDegrees(
          normalizeLon180(a.lon),
          a.lat,
          a.heightM,
          this.scene.globe.ellipsoid,
        ),
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
    });
    this.groups.set(group, placed);
    this.scene.requestRender();
  }

  setGroupVisible(group: string, visible: boolean): void {
    if (visible) this.hidden.delete(group);
    else this.hidden.add(group);
    this.scene.requestRender();
  }

  /** Muted groups yield to every other label and render dimmed (context, not focus). */
  setGroupMuted(group: string, muted: boolean): void {
    if (muted) this.muted.add(group);
    else this.muted.delete(group);
    this.scene.requestRender();
  }

  /** Call after each render (scene.postRender). */
  update(): void {
    const scene = this.scene;
    const camera = scene.camera.positionWC;
    const w = scene.canvas.clientWidth;
    const h = scene.canvas.clientHeight;
    const now = performance.now();
    const refresh = now - this.occlusionAt > OCCLUSION_MS;
    if (refresh) this.occlusionAt = now;
    else if (!this.refreshQueued) {
      // Make sure the last camera position gets a fresh occlusion pass once motion stops.
      this.refreshQueued = true;
      window.setTimeout(() => {
        this.refreshQueued = false;
        this.scene.requestRender();
      }, OCCLUSION_MS);
    }
    const candidates: Array<Placed & { x: number; y: number; d: number; rank: number }> = [];

    for (const [group, items] of this.groups) {
      for (const p of items) {
        p.el.style.visibility = 'hidden';
        if (p.stem) p.stem.style.visibility = 'hidden';
        if (p.dot) p.dot.style.visibility = 'hidden';
        if (this.hidden.has(group)) continue;
        const d = Cartesian3.distance(camera, p.anchor);
        if (p.a.maxCameraDistanceM !== undefined && d > p.a.maxCameraDistanceM) continue;
        if (p.a.minCameraDistanceM !== undefined && d < p.a.minCameraDistanceM) continue;
        if (isBehindPlanet(camera, p.anchor)) continue;
        if (refresh) this.occluded.set(p.el, this.hiddenByTerrain(camera, p.anchor, d));
        if (this.occluded.get(p.el)) continue;
        const s = scene.cartesianToCanvasCoordinates(p.anchor, this.scratch);
        if (!s || s.x < -50 || s.y < -50 || s.x > w + 50 || s.y > h + 50) continue;
        if (!p.width) {
          p.width = p.el.offsetWidth;
          p.height = p.el.offsetHeight;
        }
        const isMuted = this.muted.has(group);
        p.el.classList.toggle('annotation-muted', isMuted);
        p.dot?.classList.toggle('annotation-muted', isMuted);
        p.stem?.classList.toggle('annotation-muted', isMuted);
        candidates.push({
          ...p,
          x: s.x,
          y: s.y,
          d,
          rank: isMuted ? p.a.priority - 1000 : p.a.priority,
        });
      }
    }

    candidates.sort((a, b) => b.rank - a.rank || a.d - b.d);
    const taken: Array<[number, number, number, number]> = [];
    const shownKeys = new Set<string>();
    const overlaps = (r: [number, number, number, number]) =>
      taken.some((t) => r[0] < t[2] + 4 && r[2] + 4 > t[0] && r[1] < t[3] + 3 && r[3] + 3 > t[1]);

    // Dots first, so labels never cover a place marker.
    const pins = candidates.filter(
      (c) =>
        c.dot &&
        !(
          c.a.dedupeKey &&
          candidates.some((o) => o !== c && !o.dot && o.a.dedupeKey === c.a.dedupeKey)
        ),
    );
    for (const c of pins) {
      const half = DOT_PX / 2;
      taken.push([c.x - half, c.y - half, c.x + half, c.y + half]);
      c.dot!.style.visibility = 'visible';
      c.dot!.style.transform = `translate3d(${Math.round(c.x - half)}px, ${Math.round(c.y - half)}px, 0)`;
    }

    for (const c of candidates) {
      if (c.a.dedupeKey) {
        if (shownKeys.has(c.a.dedupeKey)) continue;
        shownKeys.add(c.a.dedupeKey);
      }
      if (c.dot) {
        if (!pins.includes(c)) continue;
        for (const stem of STEMS) {
          const left = c.x - c.width / 2;
          const top = c.y - DOT_PX / 2 - stem - c.height;
          const rect: [number, number, number, number] = [
            left,
            top,
            left + c.width,
            top + c.height,
          ];
          // The stem is an obstacle too: no label over another pin's stem, no stem through a label.
          const stemRect: [number, number, number, number] = [
            c.x - 1,
            top + c.height + 2,
            c.x + 1,
            c.y - DOT_PX / 2 - 5, // clear of its own dot (overlaps() pads by 3 px)
          ];
          if (rect[0] < 0 || rect[1] < 0 || rect[2] > w || overlaps(rect) || overlaps(stemRect))
            continue;
          taken.push(rect, stemRect);
          c.el.style.visibility = 'visible';
          c.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
          c.el.dataset.side = 'above';
          c.stem!.style.visibility = 'visible';
          c.stem!.style.height = `${stem}px`;
          c.stem!.style.transform = `translate3d(${Math.round(c.x)}px, ${Math.round(top + c.height)}px, 0)`;
          break;
        }
        continue;
      }
      for (const [dx, dy, side] of OFFSETS) {
        const left =
          side === 'left' ? c.x + dx - c.width : side === 'right' ? c.x + dx : c.x - c.width / 2;
        const top =
          side === 'above' ? c.y + dy - c.height : side === 'below' ? c.y + dy : c.y - c.height / 2;
        const rect: [number, number, number, number] = [left, top, left + c.width, top + c.height];
        if (rect[0] < 0 || rect[1] < 0 || rect[2] > w || rect[3] > h || overlaps(rect)) continue;
        taken.push(rect);
        c.el.style.visibility = 'visible';
        c.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
        c.el.dataset.side = side;
        break;
      }
    }
  }

  /** True when rendered terrain lies between the camera and the label anchor (ridges, crater rim). */
  private hiddenByTerrain(camera: Cartesian3, anchor: Cartesian3, distance: number): boolean {
    if (distance > 600_000) return false; // from orbit the sphere test is enough
    const dir = Cartesian3.normalize(
      Cartesian3.subtract(anchor, camera, new Cartesian3()),
      new Cartesian3(),
    );
    const hit = this.scene.globe.pick(new Ray(camera, dir), this.scene);
    return !!hit && Cartesian3.distance(camera, hit) < distance - Math.max(60, distance * 0.01);
  }

  destroy(): void {
    this.root.remove();
  }
}
