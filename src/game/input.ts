export interface InputState {
  throttle: number; // -1 brake/reverse .. 1 accelerate
  steer: number; // -1 left .. 1 right
  thrust: boolean;
  thrustPressed: boolean; // edge
  boost: boolean;
  roll: -1 | 0 | 1; // edge: barrel roll direction
  restart: boolean; // edge
}

export interface TouchState {
  steer: number;
  thrust: boolean;
  boost: boolean;
  brake: boolean;
}

const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

/**
 * Merges keyboard, gamepad and touch every frame. Each source keeps its own state,
 * so releasing one never leaves another stuck on.
 */
export class InputManager {
  private keys = new Set<string>();
  private rollQueue: -1 | 0 | 1 = 0;
  private thrustWasDown = false;
  private restartWas = false;
  private padRollWas = false;
  touch: TouchState = { steer: 0, thrust: false, boost: false, brake: false };
  touchActive = false;
  onPause: (() => void) | null = null;
  onAnyInput: (() => void) | null = null;

  private onKeyDown = (e: KeyboardEvent) => {
    if (BLOCK_DEFAULT.has(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    this.onAnyInput?.();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
    if (e.code === 'KeyQ') this.rollQueue = -1;
    if (e.code === 'KeyE' || e.code === 'KeyJ') this.rollQueue = 1;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.touch = { steer: 0, thrust: false, boost: false, brake: false };
  };

  private onTouchStart = () => {
    this.touchActive = true;
  };

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('touchstart', this.onTouchStart);
  }

  queueRoll(dir: -1 | 1) {
    this.rollQueue = dir;
  }

  private has(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  sample(): InputState {
    let throttle = (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
    let steer = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    let thrust = this.has('Space');
    let boost = this.has('ShiftLeft', 'ShiftRight', 'KeyK');
    let roll = this.rollQueue;
    this.rollQueue = 0;

    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) steer = ax;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
      if (pad.buttons[0]?.pressed) thrust = true;
      if (pad.buttons[2]?.pressed || pad.buttons[5]?.pressed) boost = true;
      const rollBtn = !!(pad.buttons[1]?.pressed || pad.buttons[3]?.pressed);
      if (rollBtn && !this.padRollWas) roll = steer < -0.2 ? -1 : 1;
      this.padRollWas = rollBtn;
      if (pad.buttons[9]?.pressed && !this.keys.has('__padStart')) {
        this.keys.add('__padStart');
        this.onPause?.();
      } else if (!pad.buttons[9]?.pressed) this.keys.delete('__padStart');
    }

    if (this.touchActive) {
      if (this.touch.steer !== 0) steer = this.touch.steer;
      // touch play auto-accelerates; the brake button overrides
      if (throttle === 0) throttle = this.touch.brake ? -1 : 1;
      thrust ||= this.touch.thrust;
      boost ||= this.touch.boost;
    }

    const thrustPressed = thrust && !this.thrustWasDown;
    this.thrustWasDown = thrust;
    const restartDown = this.has('KeyR');
    const restart = restartDown && !this.restartWas;
    this.restartWas = restartDown;
    return {
      throttle: Math.max(-1, Math.min(1, throttle)),
      steer: Math.max(-1, Math.min(1, steer)),
      thrust,
      thrustPressed,
      boost,
      roll,
      restart,
    };
  }
}
