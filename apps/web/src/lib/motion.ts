/** True when the user asked the system for reduced motion (animations are skipped or shortened). */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
