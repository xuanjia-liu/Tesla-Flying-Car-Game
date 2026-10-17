export interface InputState {
  forward: number; // 1 accelerate, -1 brake/reverse
  steer: number; // -1 left, 1 right
  hop: boolean;
  flip: boolean; // edge-triggered per frame
  boost: boolean;
  cushion: boolean; // edge-triggered per frame: fire landing jets
  pauseQueued: boolean;
}

type KeyHandler = (state: InputState, down: boolean) => void;

const MOVE_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class InputManager {
  private held = new Set<string>();
  private flipQueued = false;
  private cushionQueued = false;
  private pauseQueued = false;
  private touch = { steer: 0, forward: 0, hop: false, boost: false, flipQueued: false, cushionQueued: false };
  state: InputState = { forward: 0, steer: 0, hop: false, flip: false, boost: false, cushion: false, pauseQueued: false };

  private onKeyDown = (e: KeyboardEvent) => {
    if (MOVE_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.applyKey(e.code, true);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.applyKey(e.code, false);
  };

  private applyKey(code: string, down: boolean) {
    const s = this.state;
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        s.forward = down ? 1 : s.forward === 1 ? 0 : s.forward;
        break;
      case 'ArrowDown':
      case 'KeyS':
        s.forward = down ? -1 : s.forward === -1 ? 0 : s.forward;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        s.steer = down ? -1 : s.steer === -1 ? 0 : s.steer;
        break;
      case 'ArrowRight':
      case 'KeyD':
        s.steer = down ? 1 : s.steer === 1 ? 0 : s.steer;
        break;
      case 'Space':
        // in air: tap fires the cushion jets; on ground: hop
        if (down) {
          this.cushionQueued = true;
          s.hop = true;
        } else {
          s.hop = false;
        }
        break;
      case 'KeyJ':
        if (down) this.flipQueued = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'KeyK':
        s.boost = down;
        break;
      case 'KeyX':
        if (down) this.cushionQueued = true;
        break;
      case 'Escape':
      case 'KeyP':
        if (down) this.pauseQueued = true;
        break;
    }
    if (down) this.held.add(code);
    else this.held.delete(code);
  }

  private onBlur = () => {
    this.held.clear();
    this.state = { forward: 0, steer: 0, hop: false, flip: false, boost: false, cushion: false, pauseQueued: false };
    this.touch = { steer: 0, forward: 0, hop: false, boost: false, flipQueued: false, cushionQueued: false };
  };

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Call once per frame before reading state */
  beginFrame() {
    this.state.flip = this.flipQueued || this.touch.flipQueued;
    this.state.cushion = this.cushionQueued || this.touch.cushionQueued;
    this.state.pauseQueued = this.pauseQueued;
    this.flipQueued = false;
    this.cushionQueued = false;
    this.pauseQueued = false;
    this.touch.flipQueued = false;
    this.touch.cushionQueued = false;
  }

  consumePause(): boolean {
    const p = this.state.pauseQueued;
    this.state.pauseQueued = false;
    return p;
  }

  setTouch(part: Partial<TouchInput>) {
    if (part.flipQueued) this.touch.flipQueued = true;
    if (part.cushionQueued) this.touch.cushionQueued = true;
    Object.assign(this.touch, part);
  }

  applyTouch(s: InputState) {
    if (this.touch.steer !== 0) s.steer = this.touch.steer;
    if (this.touch.forward !== 0) s.forward = this.touch.forward;
    if (this.touch.hop) s.hop = true;
    if (this.touch.boost) s.boost = true;
  }
}

export interface TouchInput {
  steer: number;
  forward: number;
  hop: boolean;
  boost: boolean;
  flipQueued: boolean;
  cushionQueued: boolean;
}
