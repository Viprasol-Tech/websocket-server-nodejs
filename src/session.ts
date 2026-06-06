/**
 * Resumable connection sessions.
 *
 * Each connection is backed by a {@link Session} identified by a stable
 * `id`. Outbound messages are tagged with a monotonic `seq` and kept in
 * a bounded ring buffer. When a client reconnects and presents its
 * `sessionId` plus the last `seq` it received, the server can replay the
 * buffered messages it missed instead of dropping them.
 */
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ProtocolMessage } from "./protocol.js";

/** A message that was delivered to a session, tagged with its sequence. */
export interface BufferedMessage {
  seq: number;
  message: ProtocolMessage;
}

export interface SessionOptions {
  /** Maximum number of outbound messages to retain for replay. */
  bufferSize?: number;
  /** Id generator (injectable for deterministic tests). */
  generateId?: () => string;
}

/** A single resumable session and its replay buffer. */
export class Session {
  readonly id: string;
  /** The authenticated principal, set after a successful `auth`. */
  principal: string | undefined;
  /**
   * The live socket currently bound to this session, or `undefined` when
   * the client is disconnected (the session lives on for resume).
   */
  socket: WebSocket | undefined;
  private seq = 0;
  private readonly bufferSize: number;
  private buffer: BufferedMessage[] = [];

  constructor(options: SessionOptions = {}) {
    this.id = (options.generateId ?? randomUUID)();
    this.bufferSize = Math.max(1, options.bufferSize ?? 100);
  }

  /** The most recently assigned sequence number (0 if none). */
  get lastSeq(): number {
    return this.seq;
  }

  /**
   * Tag `message` with the next sequence number, append it to the
   * replay buffer (evicting the oldest if full), and return the tagged
   * message ready to send.
   */
  track(message: ProtocolMessage): ProtocolMessage {
    this.seq += 1;
    const tagged: ProtocolMessage = { ...message, seq: this.seq };
    this.buffer.push({ seq: this.seq, message: tagged });
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }
    return tagged;
  }

  /**
   * Return every buffered message with `seq` strictly greater than
   * `afterSeq`, in order. Used to replay what a resuming client missed.
   */
  since(afterSeq: number): ProtocolMessage[] {
    return this.buffer
      .filter((entry) => entry.seq > afterSeq)
      .map((entry) => entry.message);
  }

  /**
   * Whether a client asking to resume from `afterSeq` can be fully
   * served from the buffer. `false` means messages were evicted and the
   * gap cannot be replayed (the client should resynchronize).
   */
  canResumeFrom(afterSeq: number): boolean {
    if (afterSeq >= this.seq) {
      return true;
    }
    if (this.buffer.length === 0) {
      return afterSeq === this.seq;
    }
    return this.buffer[0].seq <= afterSeq + 1;
  }
}

/**
 * Stores sessions so that a reconnecting client can look its session up
 * by id. Sessions are evicted after `ttlMs` of inactivity, with a sweep
 * triggered lazily on access.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly lastSeen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly bufferSize: number;
  private readonly generateId: (() => string) | undefined;
  private readonly onEvict: ((session: Session) => void) | undefined;

  constructor(
    options: {
      ttlMs?: number;
      bufferSize?: number;
      now?: () => number;
      generateId?: () => string;
      /** Called for each session evicted by a TTL sweep or `delete`. */
      onEvict?: (session: Session) => void;
    } = {},
  ) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.bufferSize = options.bufferSize ?? 100;
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId;
    this.onEvict = options.onEvict;
  }

  /** Create and register a fresh session. */
  create(): Session {
    this.sweep();
    const session = new Session({
      bufferSize: this.bufferSize,
      generateId: this.generateId,
    });
    this.sessions.set(session.id, session);
    this.touch(session.id);
    return session;
  }

  /** Look up an existing session by id, refreshing its activity timestamp. */
  get(id: string): Session | undefined {
    this.sweep();
    const session = this.sessions.get(id);
    if (session) {
      this.touch(id);
    }
    return session;
  }

  /** Record activity for `id`, resetting its TTL. */
  touch(id: string): void {
    this.lastSeen.set(id, this.now());
  }

  /** Remove a session immediately (e.g. on a clean logout). */
  delete(id: string): void {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    this.lastSeen.delete(id);
    if (session) {
      this.onEvict?.(session);
    }
  }

  /** Number of live sessions. */
  get size(): number {
    return this.sessions.size;
  }

  /** Evict sessions whose last activity is older than the TTL. */
  sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, seen] of this.lastSeen) {
      if (seen < cutoff) {
        const session = this.sessions.get(id);
        this.sessions.delete(id);
        this.lastSeen.delete(id);
        if (session) {
          this.onEvict?.(session);
        }
      }
    }
  }
}
