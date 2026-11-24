export type InputAction = 'left' | 'right' | 'drive' | 'brake' | 'jump' | 'grab' | 'pause';

export class InputManager {
  private keys = new Set<string>();
  private virtual: Record<InputAction, boolean> = {
    left: false,
    right: false,
    drive: false,
    brake: false,
    jump: false,
    grab: false,
    pause: false,
  };
  private jumpQueued = false;
  private pauseQueued = false;
  private restartQueued = false;
  private attached = false;

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code) ||
      ['KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(code)
    ) {
      e.preventDefault();
    }
    if (!e.repeat && (code === 'Space' || code === 'KeyJ')) this.jumpQueued = true;
    if (!e.repeat && (code === 'Escape' || code === 'KeyP')) this.pauseQueued = true;
    if (!e.repeat && code === 'KeyR') this.restartQueued = true;
    this.keys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    (Object.keys(this.virtual) as InputAction[]).forEach((k) => (this.virtual[k] = false));
  };

  attach() {
    if (this.attached) return;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.attached = false;
  }

  setVirtual(action: InputAction, pressed: boolean) {
    this.virtual[action] = pressed;
    if (action === 'jump' && pressed) this.jumpQueued = true;
    if (action === 'pause' && pressed) this.pauseQueued = true;
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  get left(): boolean {
    return this.virtual.left || this.isDown('ArrowLeft', 'KeyA');
  }
  get right(): boolean {
    return this.virtual.right || this.isDown('ArrowRight', 'KeyD');
  }
  get drive(): boolean {
    return this.virtual.drive || this.isDown('ArrowUp', 'KeyW');
  }
  get brake(): boolean {
    return this.virtual.brake || this.isDown('ArrowDown', 'KeyS');
  }
  get grab(): boolean {
    return this.virtual.grab || this.isDown('ShiftLeft', 'ShiftRight', 'KeyG', 'KeyK');
  }

  consumeJump(): boolean {
    const q = this.jumpQueued;
    this.jumpQueued = false;
    return q;
  }

  consumePause(): boolean {
    const q = this.pauseQueued;
    this.pauseQueued = false;
    return q;
  }

  consumeRestart(): boolean {
    const q = this.restartQueued;
    this.restartQueued = false;
    return q;
  }

  /** -1 left / rail-toe-side, +1 right / rail-heel-side. */
  steerAxis(): number {
    return (this.right ? 1 : 0) - (this.left ? 1 : 0);
  }

  trimAxis(): number {
    return (this.drive ? 1 : 0) - (this.brake ? 1 : 0);
  }
}
