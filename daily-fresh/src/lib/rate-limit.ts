/**
 * Token bucket: self-cap below provider's 60 rpm.
 * acquire() resolves when a token is available, refilling at rps.
 */
export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill: number;
  private waiters: Array<() => void> = [];

  constructor(capacity: number, refillPerMinute: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerMs = refillPerMinute / 60_000;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
    while (this.tokens >= 1 && this.waiters.length > 0) {
      this.tokens -= 1;
      const next = this.waiters.shift()!;
      next();
    }
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const promise = new Promise<void>((resolve) => this.waiters.push(resolve));
    const tick = () => {
      this.refill();
      if (this.waiters.length > 0) setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
    return promise;
  }
}
