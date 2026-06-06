import { describe, it, expect } from "vitest";
import {
  encode,
  decode,
  isProtocolMessage,
  isClientMessageType,
} from "./protocol.js";

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

  it("round-trips rpc messages with id and method", () => {
    const decoded = decode(
      encode({ type: "rpc", id: "abc", method: "sum", data: [1, 2] }),
    );
    expect(decoded.id).toBe("abc");
    expect(decoded.method).toBe("sum");
    expect(decoded.data).toEqual([1, 2]);
  });

  it("round-trips resume and presence fields", () => {
    const resume = decode(encode({ type: "resume", sessionId: "s1", seq: 7 }));
    expect(resume.sessionId).toBe("s1");
    expect(resume.seq).toBe(7);

    const presence = decode(
      encode({ type: "presence", room: "r", members: ["a", "b"] }),
    );
    expect(presence.members).toEqual(["a", "b"]);
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

  it("validates field types", () => {
    expect(isProtocolMessage({ type: "join", room: 5 })).toBe(false);
    expect(isProtocolMessage({ type: "join", room: "a" })).toBe(true);
    expect(isProtocolMessage({ type: "rpc", id: 1 })).toBe(false);
    expect(isProtocolMessage({ type: "rpc", method: 2 })).toBe(false);
    expect(isProtocolMessage({ type: "auth", token: 3 })).toBe(false);
    expect(isProtocolMessage({ type: "resume", seq: "x" })).toBe(false);
    expect(isProtocolMessage({ type: "resume", sessionId: 9 })).toBe(false);
    expect(isProtocolMessage({ type: "presence", members: [1, 2] })).toBe(false);
    expect(isProtocolMessage({ type: "presence", members: ["a"] })).toBe(true);
    expect(isProtocolMessage(null)).toBe(false);
    expect(isProtocolMessage("str")).toBe(false);
  });

  it("distinguishes client message types", () => {
    expect(isClientMessageType("join")).toBe(true);
    expect(isClientMessageType("rpc")).toBe(true);
    expect(isClientMessageType("welcome")).toBe(false);
    expect(isClientMessageType("rpc_result")).toBe(false);
  });
});
