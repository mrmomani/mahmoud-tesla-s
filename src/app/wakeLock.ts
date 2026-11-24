/** Keeps the screen awake while the engine runs, where the browser supports it. */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    // The browser drops the lock whenever the page is hidden, so take it again on return.
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') void this.acquire();
    });
  }

  async enable(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    await sentinel?.release().catch(() => undefined);
  }

  private async acquire(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    if (this.sentinel && !this.sentinel.released) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
    } catch {
      // Refused (for example on low battery); the engine still works without it.
      this.sentinel = null;
    }
  }
}
