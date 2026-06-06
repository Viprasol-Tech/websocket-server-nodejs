import { describe, it, expect } from "vitest";
import { RpcRegistry, RpcMethodNotFoundError } from "./rpc.js";

const ctx = { principal: "tester", sessionId: "sess-1" };

describe("RpcRegistry", () => {
  it("registers and dispatches a sync handler", async () => {
    const registry = new RpcRegistry();
    registry.register("double", (params) => (params as number) * 2);
    expect(await registry.dispatch("double", 21, ctx)).toBe(42);
  });

  it("dispatches an async handler", async () => {
    const registry = new RpcRegistry();
    registry.register("delayed", async (params) => {
      await Promise.resolve();
      return `hi ${params as string}`;
    });
    expect(await registry.dispatch("delayed", "bob", ctx)).toBe("hi bob");
  });

  it("passes context to the handler", async () => {
    const registry = new RpcRegistry();
    registry.register("who", (_p, context) => context.principal);
    expect(await registry.dispatch("who", null, ctx)).toBe("tester");
  });

  it("throws RpcMethodNotFoundError for unknown methods", async () => {
    const registry = new RpcRegistry();
    await expect(registry.dispatch("ghost", null, ctx)).rejects.toBeInstanceOf(
      RpcMethodNotFoundError,
    );
  });

  it("rejects duplicate registrations", () => {
    const registry = new RpcRegistry();
    registry.register("x", () => 1);
    expect(() => registry.register("x", () => 2)).toThrow(/already registered/);
  });

  it("reports registered methods", () => {
    const registry = new RpcRegistry();
    registry.register("a", () => 0).register("b", () => 0);
    expect(registry.has("a")).toBe(true);
    expect(registry.has("z")).toBe(false);
    expect(registry.methods().sort()).toEqual(["a", "b"]);
  });

  it("propagates handler errors", async () => {
    const registry = new RpcRegistry();
    registry.register("fail", () => {
      throw new Error("nope");
    });
    await expect(registry.dispatch("fail", null, ctx)).rejects.toThrow("nope");
  });
});
