/** True when the user asked the system for reduced motion (animations are skipped or shortened). */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Start time of the frame being rendered (the rAF timestamp), not the moment this code runs: steps
 * are then proportional to the time between displayed frames, whatever work came earlier in the frame.
 */
export const frameTime = (): number => {
  const t = document.timeline?.currentTime;
  return typeof t === 'number' ? t : performance.now();
};
