/**
 * Calls `onIdle` once nothing has held the server busy for `ms`. Open browser
 * tabs, running jobs and open dialogs each take a hold.
 */
export class IdleWatcher {
  private holds = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly ms: number,
    private readonly onIdle: () => void,
  ) {
    this.arm();
  }

  /** Marks the server busy until the returned function is called. */
  hold(): () => void {
    this.holds++;
    clearTimeout(this.timer);
    this.timer = undefined;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holds === 0) this.arm();
    };
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm() {
    if (!Number.isFinite(this.ms)) return;
    this.timer = setTimeout(this.onIdle, this.ms);
  }
}
