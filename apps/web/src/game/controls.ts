import type { DriveInput } from './roverSim';

export type Command = 'camera' | 'pause' | 'map' | 'laser' | 'photo';

export interface ControlState extends DriveInput {
  /** Core a sample / drop the tubes (held). */
  action: boolean;
}

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const BOOST = ['ShiftLeft', 'ShiftRight'];
const ACTION = ['Space', 'KeyE'];
const COMMANDS: Record<string, Command> = {
  KeyC: 'camera',
  Escape: 'pause',
  KeyM: 'map',
  KeyF: 'laser',
  KeyP: 'photo',
};
/** Keys whose browser default (scrolling, focus moves) is suppressed while driving. */
const CAPTURED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, 'Space']);

/**
 * Keyboard (physical key positions, so WASD works on any layout) plus the on-screen pad for touch
 * screens, merged into one control state.
 */
export class Controls {
  private readonly keys = new Set<string>();
  /** An action key press not yet seen by read(): a tap shorter than a frame still counts. */
  private actionTapped = false;
  readonly touch: ControlState = { throttle: 0, steer: 0, boost: false, action: false };
  enabled = true;

  constructor(private readonly onCommand: (c: Command) => void) {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
  }

  private readonly down = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
      return;
    const command = COMMANDS[e.code];
    if (command) {
      if (!e.repeat) this.onCommand(command);
      return;
    }
    if (!this.enabled) return;
    // Space on a focused button (e.g. Camera, just clicked) would also click it: while driving
    // it is the action key, so focus leaves the button.
    if (CAPTURED.has(e.code)) {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    }
    this.keys.add(e.code);
    if (ACTION.includes(e.code) && !e.repeat) this.actionTapped = true;
  };

  private readonly up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  readonly clear = () => {
    this.keys.clear();
    this.actionTapped = false;
    Object.assign(this.touch, { throttle: 0, steer: 0, boost: false, action: false });
  };

  read(): ControlState {
    if (!this.enabled) return { throttle: 0, steer: 0, boost: false, action: false };
    const any = (codes: string[]) => codes.some((c) => this.keys.has(c));
    const throttle = (any(FORWARD) ? 1 : 0) - (any(BACK) ? 1 : 0) || this.touch.throttle;
    const steer = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0) || this.touch.steer;
    const action = any(ACTION) || this.touch.action || this.actionTapped;
    this.actionTapped = false;
    return { throttle, steer, boost: any(BOOST) || this.touch.boost, action };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.clear);
  }
}
