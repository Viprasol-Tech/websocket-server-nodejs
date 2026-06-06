import { describe, it, expect } from "vitest";
import { encode, decode, isProtocolMessage } from "./protocol.js";

describe("protocol", () => {
  it("round-trips a message through encode/decode", () => {
    const msg = { type: "message" as const, room: "lobby", data: { hi: 1 } };
    const decoded = decode(encode(msg));
    expect(decoded).toEqual(msg);
  });

  it("accepts connection-level messages without a room", () => {
    const decoded = decode(encode({ type: "error", data: "boom" }));
    expect(decoded.type).toBe("error");
    expect(decoded.room).toBeUndefined();
  });

  it("rejects invalid JSON", () => {
    expect(() => decode("{not json")).toThrow(/invalid JSON/);
  });

  it("rejects valid JSON that is not a protocol message", () => {
    expect(() => decode(JSON.stringify({ foo: "bar" }))).toThrow(
      /not a valid protocol message/,
    );
  });

  it("rejects unknown message types", () => {
    expect(() => decode(JSON.stringify({ type: "explode" }))).toThrow();
  });

  it("isProtocolMessage validates room field type", () => {
    expect(isProtocolMessage({ type: "join", room: 5 })).toBe(false);
    expect(isProtocolMessage({ type: "join", room: "a" })).toBe(true);
    expect(isProtocolMessage(null)).toBe(false);
    expect(isProtocolMessage("str")).toBe(false);
  });
});
