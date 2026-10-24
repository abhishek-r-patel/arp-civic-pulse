/*
 * A small async semaphore: callers beyond the limit WAIT their turn (up to a
 * bound) instead of failing at once. Used to cap CPU-heavy export rendering so
 * a rush of downloads near a deadline slows down rather than errors or
 * exhausts memory.
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  /** Resolves with a release function, or rejects if the wait exceeds `maxWaitMs`. */
  async acquire(maxWaitMs: number): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(grant);
        if (at >= 0) {
          this.waiting.splice(at, 1);
        }
        reject(new Error("semaphore wait exceeded"));
      }, maxWaitMs);
      this.waiting.push(grant);
    });
    // The slot was handed over by release(); `active` already counts it.
    return () => this.release();
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}
