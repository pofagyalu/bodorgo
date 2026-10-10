// The phone's screen kept on while a song is open - so it doesn't go dark
// halfway through the last verses, scrolling or not. Never for long
// unattended: IDLE_MS after the last touch (or key, or wheel) it is let
// go, unless the song is scrolling by itself just then; the next touch
// takes it again. Where the browser can't (no Wake Lock, battery saver)
// the screen does what the phone says.

const IDLE_MS = 10 * 60 * 1000;

const ACTIVITY = ['pointerdown', 'keydown', 'wheel'] as const;

export class ScreenAwake {
  private on = false;
  private sentinel: WakeLockSentinel | null = null;
  private requesting = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  // busy: true while something on the page counts as being used even
  // without a touch (the song scrolling by itself).
  constructor(private busy: () => boolean = () => false) {}

  start() {
    if (this.on) return;
    this.on = true;
    for (const type of ACTIVITY) document.addEventListener(type, this.renew, { passive: true });
    document.addEventListener('visibilitychange', this.onVisible);
    this.renew();
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    for (const type of ACTIVITY) document.removeEventListener(type, this.renew);
    document.removeEventListener('visibilitychange', this.onVisible);
    clearTimeout(this.idleTimer);
    this.release();
  }

  // Someone is using the page: the screen stays on for IDLE_MS from now.
  renew = () => {
    if (!this.on) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(this.onIdle, IDLE_MS);
    void this.hold();
  };

  private onIdle = () => {
    if (this.busy()) this.renew();
    else this.release();
  };

  // Back on the page: the browser let the lock go while it was hidden.
  private onVisible = () => {
    if (document.visibilityState === 'visible') this.renew();
  };

  private async hold() {
    if (this.sentinel || this.requesting || !navigator.wakeLock) return;
    if (document.visibilityState !== 'visible') return;
    this.requesting = true;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      // Let go in the meantime (the song closed): not kept.
      if (!this.on) {
        void sentinel.release().catch(() => {});
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // Not allowed (battery saver...): the phone decides.
    } finally {
      this.requesting = false;
    }
  }

  private release() {
    void this.sentinel?.release().catch(() => {});
    this.sentinel = null;
  }
}
