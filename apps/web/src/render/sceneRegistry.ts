import type { MarsScene } from './marsScene';

/** The live scene, for features outside the canvas that need it (e.g. the briefing map snapshot). */
let scene: MarsScene | null = null;
export const registerScene = (s: MarsScene | null): void => {
  scene = s;
};
export const currentScene = (): MarsScene | null => (scene && !scene.isDestroyed() ? scene : null);
