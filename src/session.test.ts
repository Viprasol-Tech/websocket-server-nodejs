import { describe, it, expect } from "vitest";
import { Session, SessionStore } from "./session.js";

describe("Session", () => {
  it("assigns increasing sequence numbers to tracked messages", () => {
    const session = new Session();
    const a = session.track({ type: "message", data: "a" });
    const b = session.track({ type: "message", data: "b" });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(session.lastSeq).toBe(2);
  });

  it("replays only messages after a given seq", () => {
    const session = new Session();
    session.track({ type: "message", data: 1 });
    session.track({ type: "message", data: 2 });
    session.track({ type: "message", data: 3 });
    const missed = session.since(1);
    expect(missed.map((m) => m.data)).toEqual([2, 3]);
  });

  it("evicts the oldest message when the buffer is full", () => {
    const session = new Session({ bufferSize: 2 });
    session.track({ type: "message", data: 1 });
    session.track({ type: "message", data: 2 });
    session.track({ type: "message", data: 3 });
    // Message 1 was evicted; replaying from 0 yields only 2 and 3.
    expect(session.since(0).map((m) => m.data)).toEqual([2, 3]);
  });

  it("knows whether a resume point is still in the buffer", () => {
    const session = new Session({ bufferSize: 2 });
    session.track({ type: "message" });
    session.track({ type: "message" });
    session.track({ type: "message" }); // seq 1 evicted, buffer holds 2,3
    expect(session.canResumeFrom(3)).toBe(true); // nothing missed
    expect(session.canResumeFrom(2)).toBe(true); // wants 3, present
    expect(session.canResumeFrom(1)).toBe(true); // wants 2,3, both present
    expect(session.canResumeFrom(0)).toBe(false); // wants 1, evicted
  });

  it("uses an injectable id generator", () => {
    const session = new Session({ generateId: () => "fixed-id" });
    expect(session.id).toBe("fixed-id");
  });
});

describe("SessionStore", () => {
  it("creates and retrieves sessions by id", () => {
    const store = new SessionStore();
    const s = store.create();
    expect(store.get(s.id)).toBe(s);
    expect(store.size).toBe(1);
  });

  it("returns undefined for unknown ids", () => {
    const store = new SessionStore();
    expect(store.get("missing")).toBeUndefined();
  });

  it("evicts sessions after the TTL elapses", () => {
    let t = 0;
    const store = new SessionStore({ ttlMs: 1000, now: () => t });
    const s = store.create();
    expect(store.get(s.id)).toBeDefined();
    t += 1500;
    expect(store.get(s.id)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("touch refreshes the TTL", () => {
    let t = 0;
    const store = new SessionStore({ ttlMs: 1000, now: () => t });
    const s = store.create();
    t += 800;
    store.touch(s.id);
    t += 800; // 1600 total, but only 800 since touch
    expect(store.get(s.id)).toBeDefined();
  });

  it("deletes sessions explicitly", () => {
    const store = new SessionStore();
    const s = store.create();
    store.delete(s.id);
    expect(store.get(s.id)).toBeUndefined();
  });

  it("invokes onEvict for both TTL sweeps and explicit deletes", () => {
    let t = 0;
    const evicted: string[] = [];
    const store = new SessionStore({
      ttlMs: 1000,
      now: () => t,
      onEvict: (s) => evicted.push(s.id),
    });
    const a = store.create();
    const b = store.create();
    store.delete(a.id);
    expect(evicted).toContain(a.id);
    t += 2000;
    store.sweep();
    expect(evicted).toContain(b.id);
  });
});
