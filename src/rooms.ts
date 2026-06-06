import type { WebSocket } from "ws";

/**
 * Tracks room membership and provides broadcast helpers.
 *
 * A room is an arbitrary string key. Each socket may belong to any
 * number of rooms. Membership is stored bidirectionally so that
 * disconnects can be cleaned up in O(rooms-per-socket) time.
 */
export class RoomManager {
  /** room name -> set of member sockets */
  private readonly rooms = new Map<string, Set<WebSocket>>();
  /** socket -> set of rooms it belongs to */
  private readonly membership = new Map<WebSocket, Set<string>>();

  /**
   * Add `socket` to `room`. Returns `true` if the socket was newly
   * added, `false` if it was already a member.
   */
  join(room: string, socket: WebSocket): boolean {
    let members = this.rooms.get(room);
    if (!members) {
      members = new Set();
      this.rooms.set(room, members);
    }
    let joined = this.membership.get(socket);
    if (!joined) {
      joined = new Set();
      this.membership.set(socket, joined);
    }
    if (members.has(socket)) {
      return false;
    }
    members.add(socket);
    joined.add(room);
    return true;
  }

  /**
   * Remove `socket` from `room`. Returns `true` if the socket was a
   * member and was removed, `false` otherwise.
   */
  leave(room: string, socket: WebSocket): boolean {
    const members = this.rooms.get(room);
    if (!members || !members.has(socket)) {
      return false;
    }
    members.delete(socket);
    if (members.size === 0) {
      this.rooms.delete(room);
    }
    const joined = this.membership.get(socket);
    if (joined) {
      joined.delete(room);
      if (joined.size === 0) {
        this.membership.delete(socket);
      }
    }
    return true;
  }

  /** Remove `socket` from every room it belongs to (e.g. on disconnect). */
  leaveAll(socket: WebSocket): void {
    const joined = this.membership.get(socket);
    if (!joined) {
      return;
    }
    for (const room of joined) {
      const members = this.rooms.get(room);
      if (members) {
        members.delete(socket);
        if (members.size === 0) {
          this.rooms.delete(room);
        }
      }
    }
    this.membership.delete(socket);
  }

  /** Return the current members of `room` (empty array if none). */
  members(room: string): WebSocket[] {
    const members = this.rooms.get(room);
    return members ? [...members] : [];
  }

  /** Return the rooms `socket` currently belongs to. */
  roomsOf(socket: WebSocket): string[] {
    const joined = this.membership.get(socket);
    return joined ? [...joined] : [];
  }

  /** Number of distinct rooms with at least one member. */
  get roomCount(): number {
    return this.rooms.size;
  }
}
