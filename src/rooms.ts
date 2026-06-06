import type { Session } from "./session.js";

/**
 * Tracks room membership at the **session** level (not the socket level)
 * and provides presence helpers.
 *
 * Membership is keyed by {@link Session} so that a client which drops and
 * later resumes stays subscribed to its rooms while it is offline. This
 * is what makes the resume/replay flow work: broadcasts can still be
 * buffered onto a disconnected member's session.
 *
 * Each session may belong to any number of rooms. Membership is stored
 * bidirectionally so disconnects/evictions clean up in
 * O(rooms-per-session) time.
 */
export class RoomManager {
  /** room name -> set of member sessions */
  private readonly rooms = new Map<string, Set<Session>>();
  /** session -> set of rooms it belongs to */
  private readonly membership = new Map<Session, Set<string>>();

  /**
   * Add `session` to `room`. Returns `true` if newly added, `false` if
   * it was already a member.
   */
  join(room: string, session: Session): boolean {
    let members = this.rooms.get(room);
    if (!members) {
      members = new Set();
      this.rooms.set(room, members);
    }
    let joined = this.membership.get(session);
    if (!joined) {
      joined = new Set();
      this.membership.set(session, joined);
    }
    if (members.has(session)) {
      return false;
    }
    members.add(session);
    joined.add(room);
    return true;
  }

  /**
   * Remove `session` from `room`. Returns `true` if it was a member and
   * was removed, `false` otherwise.
   */
  leave(room: string, session: Session): boolean {
    const members = this.rooms.get(room);
    if (!members || !members.has(session)) {
      return false;
    }
    members.delete(session);
    if (members.size === 0) {
      this.rooms.delete(room);
    }
    const joined = this.membership.get(session);
    if (joined) {
      joined.delete(room);
      if (joined.size === 0) {
        this.membership.delete(session);
      }
    }
    return true;
  }

  /** Remove `session` from every room it belongs to (e.g. on eviction). */
  leaveAll(session: Session): void {
    const joined = this.membership.get(session);
    if (!joined) {
      return;
    }
    for (const room of joined) {
      const members = this.rooms.get(room);
      if (members) {
        members.delete(session);
        if (members.size === 0) {
          this.rooms.delete(room);
        }
      }
    }
    this.membership.delete(session);
  }

  /** Return the current member sessions of `room` (empty array if none). */
  members(room: string): Session[] {
    const members = this.rooms.get(room);
    return members ? [...members] : [];
  }

  /**
   * Return the presence roster for `room`: the sorted, de-duplicated list
   * of member principals. Sessions without a principal (unauthenticated)
   * are reported as `"anonymous"`.
   */
  presence(room: string): string[] {
    const members = this.rooms.get(room);
    if (!members) {
      return [];
    }
    const labels = new Set<string>();
    for (const session of members) {
      labels.add(session.principal ?? "anonymous");
    }
    return [...labels].sort();
  }

  /** Return the rooms `session` currently belongs to. */
  roomsOf(session: Session): string[] {
    const joined = this.membership.get(session);
    return joined ? [...joined] : [];
  }

  /** Number of distinct rooms with at least one member. */
  get roomCount(): number {
    return this.rooms.size;
  }
}
