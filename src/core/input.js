/**
 * Unified keyboard + mouse input. Keys and mouse buttons are both identified by
 * "codes" (KeyboardEvent.code, or Mouse0/Mouse1/Mouse2) so any action can be
 * bound to either. Edge events (pressed/released) accumulate until `endFrame()`.
 */
export class Input {
  constructor(element, settings) {
    this.element = element;
    this.settings = settings;
    this.down = new Set();
    this.pressedCodes = new Set();
    this.releasedCodes = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.enabled = true;
    this.captureListener = null; // used by the key-rebinding UI
    this.onLockChange = null;
    this.onLockError = null;
    this.rawMouse = true;
    this.lockReturnsPromise = false;

    const press = (code) => {
      if (this.captureListener) {
        const cb = this.captureListener;
        this.captureListener = null;
        cb(code);
        return;
      }
      if (!this.down.has(code)) this.pressedCodes.add(code);
      this.down.add(code);
    };
    const release = (code) => {
      if (this.down.has(code)) this.releasedCodes.add(code);
      this.down.delete(code);
    };

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.locked || this.captureListener) {
        if (e.code !== 'F5' && e.code !== 'F12') e.preventDefault();
      }
      press(e.code);
    });
    window.addEventListener('keyup', (e) => release(e.code));
    window.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.captureListener) return;
      press('Mouse' + e.button);
    });
    window.addEventListener('mouseup', (e) => release('Mouse' + e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Guard against occasional huge spikes some browsers emit on lock.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.down.clear();
      this.onLockChange?.(this.locked);
    });
    // Older browsers report failures only through this event (no promise).
    document.addEventListener('pointerlockerror', () => {
      if (!this.lockReturnsPromise) this.onLockError?.();
    });
  }

  /**
   * Capture the mouse. Raw (unaccelerated) movement is preferred and dropped
   * if the browser doesn't support it. Any other failure, e.g. Chrome's
   * cooldown right after Esc released the lock, calls `onLockError` so the
   * game doesn't keep running with no mouse control.
   */
  requestLock() {
    if (document.pointerLockElement === this.element) return;
    const fail = () => this.onLockError?.();
    try {
      const p = this.element.requestPointerLock?.(this.rawMouse ? { unadjustedMovement: true } : undefined);
      this.lockReturnsPromise = !!(p && p.catch);
      if (this.lockReturnsPromise) {
        p.catch((err) => {
          if (this.rawMouse && err?.name === 'NotSupportedError') {
            this.rawMouse = false;
            this.requestLock();
          } else {
            fail();
          }
        });
      }
    } catch {
      fail();
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  code(action) {
    return this.settings.bindings[action];
  }
  isDown(action) {
    return this.down.has(this.code(action));
  }
  pressed(action) {
    return this.pressedCodes.has(this.code(action));
  }
  released(action) {
    return this.releasedCodes.has(this.code(action));
  }
  /** Raw code check (used for fixed UI keys like Escape). */
  codePressed(code) {
    return this.pressedCodes.has(code);
  }

  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  captureNextCode(cb) {
    this.captureListener = cb;
  }

  endFrame() {
    this.pressedCodes.clear();
    this.releasedCodes.clear();
  }
}
