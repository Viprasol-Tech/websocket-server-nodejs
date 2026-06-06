import { describe, it, expect } from "vitest";
import { TokenBucket } from "./rate-limiter.js";

/** A controllable clock for deterministic time-based assertions. */
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("TokenBucket", () => {
  it("starts full and drains one token per accepted action", () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 });
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(false);
  });

  it("refills over time at the configured rate", () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({
      capacity: 2,
      refillPerSecond: 2,
      now: clock.now,
    });
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(false);

    // 500ms at 2/sec => 1 token back.
    clock.advance(500);
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(false);
  });

  it("never exceeds capacity when refilling", () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({
      capacity: 5,
      refillPerSecond: 100,
      now: clock.now,
    });
    bucket.tryRemove();
    clock.advance(10_000);
    expect(bucket.available()).toBe(5);
  });

  it("supports variable costs", () => {
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 1 });
    expect(bucket.tryRemove(7)).toBe(true);
    expect(bucket.tryRemove(7)).toBe(false);
    expect(bucket.tryRemove(3)).toBe(true);
  });

  it("validates constructor and cost arguments", () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(
      () => new TokenBucket({ capacity: 1, refillPerSecond: 0 }),
    ).toThrow();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1 });
    expect(() => bucket.tryRemove(0)).toThrow();
  });
});
