import type { WalkFrame } from '../../render/walkSim';

/** Per-frame state of the running walk simulation, for the HUD (no React re-render per frame). */
export interface WalkStatus extends WalkFrame {
  /** Factor from drawn-track metres to the planner's profile metres. */
  toProfile: number;
  /** Profile distances (m) of the intermediate stops and the end, with their waypoint index. */
  stops: Array<{ distanceM: number; waypoint: number }>;
}

type Listener = (s: WalkStatus | null) => void;
const listeners = new Set<Listener>();
let current: WalkStatus | null = null;

export const walkFeed = {
  publish(s: WalkStatus | null) {
    current = s;
    for (const l of listeners) l(s);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    l(current);
    return () => listeners.delete(l);
  },
};

/** Set by the canvas while a walk runs. */
export const walkControls: { setPaused: (paused: boolean) => void } = { setPaused: () => {} };
