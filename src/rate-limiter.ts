/**
 * A simple token-bucket rate limiter.
 *
 * Each bucket starts full with `capacity` tokens and refills at
 * `refillPerSecond` tokens per second (continuously, not in discrete
 * ticks). Every accepted action costs one token. When the bucket is
 * empty, {@link TokenBucket.tryRemove} returns `false` so the caller
 * can reject or throttle the action.
 *
 * The bucket is allocation-free and uses a monotonic clock injected via
 * the constructor, which keeps it deterministic and trivially testable.
 */
export interface TokenBucketOptions {
  /** Maximum number of tokens the bucket can hold. Must be > 0. */
  capacity: number;
  /** Tokens replenished per second. Must be > 0. */
  refillPerSecond: number;
  /** Monotonic clock in milliseconds. Defaults to {@link Date.now}. */
  now?: () => number;
}

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefill: number;

  constructor(options: TokenBucketOptions) {
    if (options.capacity <= 0) {
      throw new Error("capacity must be > 0");
    }
    if (options.refillPerSecond <= 0) {
      throw new Error("refillPerSecond must be > 0");
    }
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerSecond / 1000;
    this.now = options.now ?? Date.now;
    this.tokens = options.capacity;
    this.lastRefill = this.now();
  }

  /** Refill tokens based on elapsed time since the last refill. */
  private refill(): void {
    const current = this.now();
    const elapsed = current - this.lastRefill;
    if (elapsed <= 0) {
      return;
    }
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerMs,
    );
    this.lastRefill = current;
  }

  /** Current number of available tokens (after refilling). */
  available(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Attempt to consume `cost` tokens. Returns `true` and deducts them
   * if available, otherwise returns `false` and leaves the bucket
   * unchanged.
   */
  tryRemove(cost = 1): boolean {
    if (cost <= 0) {
      throw new Error("cost must be > 0");
    }
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }
}
