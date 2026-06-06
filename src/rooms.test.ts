import { describe, it, expect } from "vitest";
import { RoomManager } from "./rooms.js";
import { Session } from "./session.js";

function session(principal?: string): Session {
  const s = new Session();
  s.principal = principal;
  return s;
}

describe("RoomManager", () => {
  it("tracks membership and reports members", () => {
    const rooms = new RoomManager();
    const a = session();
    const b = session();
    expect(rooms.join("r", a)).toBe(true);
    expect(rooms.join("r", a)).toBe(false); // already a member
    rooms.join("r", b);
    expect(rooms.members("r")).toHaveLength(2);
    expect(rooms.roomCount).toBe(1);
  });

  it("removes a session on leave and prunes empty rooms", () => {
    const rooms = new RoomManager();
    const a = session();
    rooms.join("r", a);
    expect(rooms.leave("r", a)).toBe(true);
    expect(rooms.leave("r", a)).toBe(false);
    expect(rooms.members("r")).toHaveLength(0);
    expect(rooms.roomCount).toBe(0);
  });

  it("leaveAll removes a session from every room", () => {
    const rooms = new RoomManager();
    const a = session("amy");
    rooms.join("r1", a);
    rooms.join("r2", a);
    expect(rooms.roomsOf(a)).toHaveLength(2);
    rooms.leaveAll(a);
    expect(rooms.roomsOf(a)).toHaveLength(0);
    expect(rooms.roomCount).toBe(0);
  });

  it("presence reports sorted, de-duplicated principals", () => {
    const rooms = new RoomManager();
    const a = session("zed");
    const b = session("amy");
    const c = session(); // no principal -> anonymous
    rooms.join("room", a);
    rooms.join("room", b);
    rooms.join("room", c);
    expect(rooms.presence("room")).toEqual(["amy", "anonymous", "zed"]);
  });

  it("presence is empty for an unknown room", () => {
    const rooms = new RoomManager();
    expect(rooms.presence("nope")).toEqual([]);
  });
});
