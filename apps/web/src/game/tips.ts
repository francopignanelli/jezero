import { useEffect, useRef, useState } from 'react';
import type { Hud } from './store';

/**
 * How to play, taught while playing: one tip at a time on the prompt line at the bottom, when
 * nothing more urgent is shown there, in this order, each once (kept in this browser). Driving is
 * shown until the player has driven; the others for a few seconds each, a while apart. The tip on
 * time warp waits until AutoNav is driving, and is learned by using it.
 */
export const TIPS = ['drive', 'look', 'map', 'inventory', 'warp', 'photo', 'pause'] as const;
export type Tip = (typeof TIPS)[number];

const KEY = 'copernico.game.tips.v1';
/** A tip stays this long (s of mission time), with this gap before the next. */
const SHOW_S = 9;
const GAP_S = 12;
/** No tip but driving in the first seconds on a map. */
const SETTLE_S = 6;
/** Driving is learned after this many metres. */
export const DRIVEN_M = 15;

function readSeen(): Tip[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v)
      ? (v.filter((x) => (TIPS as readonly string[]).includes(x as string)) as Tip[])
      : [];
  } catch {
    return [];
  }
}
function writeSeen(list: Tip[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore: the tips simply come back next time
  }
}

/** The next tip the state of play allows (pure): null when none fits now. */
export function nextTip(
  seen: readonly Tip[],
  hud: Pick<Hud, 'autonav' | 'odometerM' | 'warp'>,
): Tip | null {
  for (const t of TIPS) {
    if (seen.includes(t)) continue;
    if (t === 'drive' && hud.odometerM >= DRIVEN_M) continue;
    if (t === 'warp' && (!hud.autonav || hud.warp > 1)) continue;
    return t;
  }
  return null;
}

/** The tip to show now; `free`: nothing more urgent is on the prompt line. */
export function useTip(hud: Hud, free: boolean): Tip | null {
  const seen = useRef<Tip[]>(readSeen());
  const lastEnd = useRef(-Infinity);
  const [active, setActive] = useState<{ tip: Tip; at: number } | null>(null);
  const t = hud.elapsedS;

  useEffect(() => {
    const learn = (tip: Tip) => {
      if (seen.current.includes(tip)) return;
      seen.current = [...seen.current, tip];
      writeSeen(seen.current);
    };
    // Learned by doing, shown or not.
    if (hud.odometerM >= DRIVEN_M) learn('drive');
    if (hud.warp > 1) learn('warp');
    if (active) {
      const over = active.tip === 'drive' ? hud.odometerM >= DRIVEN_M : t - active.at >= SHOW_S;
      if (over || seen.current.includes(active.tip)) {
        learn(active.tip);
        lastEnd.current = t;
        setActive(null);
      }
      return;
    }
    if (!free) return;
    const tip = nextTip(seen.current, hud);
    if (!tip) return;
    if (tip !== 'drive' && (t < SETTLE_S || t - lastEnd.current < GAP_S)) return;
    setActive({ tip, at: t });
  }, [hud, free, active, t]);

  return active && free ? active.tip : null;
}
