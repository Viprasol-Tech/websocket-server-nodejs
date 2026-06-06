import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { RoomManager } from "./rooms.js";
import { TokenBucket } from "./rate-limiter.js";
import { RpcRegistry, RpcMethodNotFoundError, type RpcHandler } from "./rpc.js";
import { Session, SessionStore } from "./session.js";
import { decode, encode, type ProtocolMessage } from "./protocol.js";

/**
 * Authenticate a connection from the token presented in the `auth`
 * message. Return a non-empty principal string to accept (it becomes the
 * connection's identity and presence label), or `null`/`undefined` to
 * reject. May be async (e.g. to verify a JWT against a key set).
 */
export type AuthenticateFn = (
  token: string | undefined,
) => string | null | undefined | Promise<string | null | undefined>;

/** Options for {@link createServer}. */
export interface ServerOptions {
  /**
   * Host interface to bind. Defaults to `127.0.0.1`. Pass `0.0.0.0`
   * to listen on all interfaces.
   */
  host?: string;
  /** Optional hook invoked for every successfully parsed inbound message. */
  onMessage?: (socket: WebSocket, message: ProtocolMessage) => void;
  /**
   * Require clients to authenticate (send `auth`) before performing any
   * other operation. When `authenticate` is provided this defaults to
   * `true`; otherwise connections are treated as anonymous.
   */
  requireAuth?: boolean;
  /** Verifies the token from the `auth` handshake. See {@link AuthenticateFn}. */
  authenticate?: AuthenticateFn;
  /**
   * Heartbeat interval in milliseconds. The server pings every client on
   * this cadence and terminates clients that miss two consecutive pings.
   * Set to `0` to disable. Defaults to `30000`.
   */
  heartbeatIntervalMs?: number;
  /**
   * Per-connection rate limit. Each inbound message costs one token.
   * Defaults to 50 messages capacity refilling at 25/sec. Set to `null`
   * to disable rate limiting.
   */
  rateLimit?: { capacity: number; refillPerSecond: number } | null;
  /** Pre-populate the RPC registry; handlers can also be added later. */
  rpc?: RpcRegistry;
  /** Replay buffer size per session for the resume protocol. Defaults to 100. */
  resumeBufferSize?: number;
  /** Session inactivity TTL in milliseconds for resume. Defaults to 60000. */
  sessionTtlMs?: number;
}

/** Per-connection state the server keeps alongside each socket. */
interface ConnectionState {
  session: Session;
  authenticated: boolean;
  /** Tracks heartbeat liveness; reset to `true` on every pong. */
  alive: boolean;
  limiter: TokenBucket | null;
}

/** Handle returned by {@link createServer} for inspecting and stopping the server. */
export interface ServerHandle {
  /** The underlying `ws` server instance. */
  readonly wss: WebSocketServer;
  /** The actual TCP port the server is listening on (resolved even for port 0). */
  readonly port: number;
  /** The room membership manager backing this server. */
  readonly rooms: RoomManager;
  /** The RPC method registry; register additional methods here. */
  readonly rpc: RpcRegistry;
  /** The resumable-session store. */
  readonly sessions: SessionStore;
  /** Register an RPC method. Convenience wrapper over `rpc.register`. */
  registerRpc(method: string, handler: RpcHandler): void;
  /**
   * Broadcast a `message` payload to every member of `room`.
   *
   * @param exclude optional socket to skip (typically the sender).
   * @returns the number of sockets the message was delivered to.
   */
  broadcast(room: string, data: unknown, exclude?: WebSocket): number;
  /** Gracefully close all connections and stop listening. Resolves when fully closed. */
  close(): Promise<void>;
}

/**
 * Start a WebSocket server on `port`.
 *
 * Pass `0` to bind an ephemeral port (useful for tests); the resolved
 * port is available on the returned handle's `port` property.
 *
 * The server speaks the typed JSON protocol from `./protocol`, covering:
 *   - `auth`     -> verify a token; replies `{ type: "authed", data: principal }`
 *   - `join`     -> add to a room; replies `{ type: "joined", room }`
 *   - `leave`    -> remove from a room; replies `{ type: "left", room }`
 *   - `message`  -> broadcast to all other room members
 *   - `presence` -> reply `{ type: "presence", room, members }`
 *   - `ping`/`pong` -> liveness; the server also pings on a timer
 *   - `rpc`      -> dispatch a registered method; replies `rpc_result`/`rpc_error`
 *   - `resume`   -> replay messages missed since a given `seq`
 *
 * Malformed payloads, rate-limit violations, and protocol errors receive
 * an `{ type: "error", data }` reply.
 */
export function createServer(
  port: number,
  options: ServerOptions = {},
): Promise<ServerHandle> {
  const {
    host = "127.0.0.1",
    onMessage,
    authenticate,
    heartbeatIntervalMs = 30_000,
    rateLimit = { capacity: 50, refillPerSecond: 25 },
    resumeBufferSize = 100,
    sessionTtlMs = 60_000,
  } = options;
  const requireAuth = options.requireAuth ?? authenticate !== undefined;
  const rooms = new RoomManager();
  const rpc = options.rpc ?? new RpcRegistry();
  const sessions = new SessionStore({
    bufferSize: resumeBufferSize,
    ttlMs: sessionTtlMs,
    // When a session is reclaimed, drop its room membership too.
    onEvict: (session) => rooms.leaveAll(session),
  });
  const states = new WeakMap<WebSocket, ConnectionState>();

  /**
   * Track `message` on `session` (assigning a seq and buffering it for
   * replay), then deliver it to the session's live socket if one is
   * attached and open. Returns `true` if a live socket received it.
   */
  const deliverToSession = (
    session: Session,
    message: ProtocolMessage,
  ): boolean => {
    const tagged = session.track(message);
    const socket = session.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(encode(tagged));
      return true;
    }
    return false;
  };

  /** Track-and-send a reply to the socket that issued a request. */
  const sendTracked = (socket: WebSocket, message: ProtocolMessage): void => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const state = states.get(socket);
    const outbound = state ? state.session.track(message) : message;
    socket.send(encode(outbound));
  };

  /**
   * Broadcast a `message` payload to every member session of `room`. The
   * message is tracked on each member's session, so members that are
   * momentarily disconnected will receive it on resume. `exclude` skips a
   * single sender socket.
   *
   * @returns the number of member sessions the message was tracked for.
   */
  const broadcast = (
    room: string,
    data: unknown,
    exclude?: WebSocket,
  ): number => {
    const excludeSession = exclude ? states.get(exclude)?.session : undefined;
    let delivered = 0;
    for (const member of rooms.members(room)) {
      if (member === excludeSession) {
        continue;
      }
      deliverToSession(member, { type: "message", room, data });
      delivered += 1;
    }
    return delivered;
  };

  return new Promise<ServerHandle>((resolve, reject) => {
    const wss = new WebSocketServer({ port, host });

    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const handleMessage = async (
      socket: WebSocket,
      raw: string,
    ): Promise<void> => {
      const state = states.get(socket);
      if (!state) {
        return;
      }

      // Per-connection rate limiting.
      if (state.limiter && !state.limiter.tryRemove()) {
        sendTracked(socket, {
          type: "error",
          data: "rate limit exceeded",
        });
        return;
      }

      let message: ProtocolMessage;
      try {
        message = decode(raw);
      } catch (err) {
        sendTracked(socket, {
          type: "error",
          data: err instanceof Error ? err.message : "decode error",
        });
        return;
      }

      onMessage?.(socket, message);
      sessions.touch(state.session.id);

      // Heartbeat replies are always allowed.
      if (message.type === "ping") {
        sendTracked(socket, { type: "pong" });
        return;
      }
      if (message.type === "pong") {
        state.alive = true;
        return;
      }

      // Auth handshake.
      if (message.type === "auth") {
        const principal = authenticate
          ? await authenticate(message.token)
          : (message.token ?? "anonymous");
        if (!principal) {
          sendTracked(socket, { type: "error", data: "authentication failed" });
          return;
        }
        state.authenticated = true;
        state.session.principal = principal;
        sendTracked(socket, { type: "authed", data: principal });
        return;
      }

      // Gate everything else behind auth when required.
      if (requireAuth && !state.authenticated) {
        sendTracked(socket, {
          type: "error",
          data: "authentication required",
        });
        return;
      }

      switch (message.type) {
        case "join": {
          if (!message.room) {
            sendTracked(socket, { type: "error", data: "join requires a room" });
            return;
          }
          rooms.join(message.room, state.session);
          sendTracked(socket, { type: "joined", room: message.room });
          break;
        }
        case "leave": {
          if (!message.room) {
            sendTracked(socket, {
              type: "error",
              data: "leave requires a room",
            });
            return;
          }
          rooms.leave(message.room, state.session);
          sendTracked(socket, { type: "left", room: message.room });
          break;
        }
        case "message": {
          if (!message.room) {
            sendTracked(socket, {
              type: "error",
              data: "message requires a room",
            });
            return;
          }
          broadcast(message.room, message.data, socket);
          break;
        }
        case "presence": {
          if (!message.room) {
            sendTracked(socket, {
              type: "error",
              data: "presence requires a room",
            });
            return;
          }
          sendTracked(socket, {
            type: "presence",
            room: message.room,
            members: rooms.presence(message.room),
          });
          break;
        }
        case "rpc": {
          if (!message.id) {
            sendTracked(socket, { type: "error", data: "rpc requires an id" });
            return;
          }
          if (!message.method) {
            sendTracked(socket, {
              type: "rpc_error",
              id: message.id,
              data: "rpc requires a method",
            });
            return;
          }
          try {
            const result = await rpc.dispatch(message.method, message.data, {
              principal: state.session.principal,
              sessionId: state.session.id,
            });
            sendTracked(socket, {
              type: "rpc_result",
              id: message.id,
              data: result,
            });
          } catch (err) {
            sendTracked(socket, {
              type: "rpc_error",
              id: message.id,
              data:
                err instanceof RpcMethodNotFoundError
                  ? err.message
                  : err instanceof Error
                    ? err.message
                    : "rpc handler error",
            });
          }
          break;
        }
        case "resume": {
          if (!message.sessionId) {
            sendTracked(socket, {
              type: "error",
              data: "resume requires a sessionId",
            });
            return;
          }
          const target = sessions.get(message.sessionId);
          const from = typeof message.seq === "number" ? message.seq : 0;
          if (!target || !target.canResumeFrom(from)) {
            // Cannot resume: keep the fresh session created on connect and
            // tell the client to resynchronize.
            sendTracked(socket, {
              type: "error",
              data: "cannot resume: session unknown or replay buffer expired",
            });
            return;
          }
          // Rebind this connection to the resumed session. Drop the
          // throwaway session created on connect (and its room membership).
          if (state.session.id !== target.id) {
            state.session.socket = undefined;
            rooms.leaveAll(state.session);
            sessions.delete(state.session.id);
          }
          state.session = target;
          state.authenticated = target.principal !== undefined;
          target.socket = socket;
          const missed = target.since(from);
          // Announce the resume (untracked) and replay missed messages
          // verbatim, preserving their original sequence numbers.
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              encode({
                type: "resumed",
                sessionId: target.id,
                seq: target.lastSeq,
              }),
            );
            for (const m of missed) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(encode(m));
              }
            }
          }
          break;
        }
        default: {
          sendTracked(socket, {
            type: "error",
            data: `unsupported message type: ${message.type}`,
          });
        }
      }
    };

    wss.on("connection", (socket: WebSocket) => {
      // Every connection gets a fresh session immediately and a `welcome`
      // carrying its sessionId. A client that wants to continue a previous
      // session sends `resume` as its first message, which rebinds this
      // connection to the prior session and replays missed traffic.
      const session = sessions.create();
      const limiter = rateLimit
        ? new TokenBucket({
            capacity: rateLimit.capacity,
            refillPerSecond: rateLimit.refillPerSecond,
          })
        : null;
      const state: ConnectionState = {
        session,
        authenticated: false,
        alive: true,
        limiter,
      };
      session.socket = socket;
      states.set(socket, state);
      sendTracked(socket, { type: "welcome", sessionId: session.id });

      socket.on("message", (raw) => {
        void handleMessage(socket, raw.toString());
      });

      const detach = (): void => {
        // Unbind the live socket but keep the session (and its room
        // membership) alive so the client can resume and replay. The
        // session is reclaimed later by the store's TTL sweep, which also
        // removes it from its rooms via the onEvict hook.
        const s = states.get(socket);
        if (s && s.session.socket === socket) {
          s.session.socket = undefined;
        }
      };
      socket.on("close", detach);
      socket.on("error", detach);
    });

    if (heartbeatIntervalMs > 0) {
      heartbeat = setInterval(() => {
        for (const client of wss.clients) {
          const state = states.get(client);
          if (!state) {
            continue;
          }
          if (!state.alive) {
            // Missed the previous heartbeat: drop the dead client. The
            // session is retained for resume and reclaimed by TTL sweep.
            client.terminate();
            continue;
          }
          state.alive = false;
          if (client.readyState === WebSocket.OPEN) {
            // Application-level heartbeat: the client is expected to reply
            // with `{ type: "pong" }`, which resets `alive` in handleMessage.
            // We also emit a WebSocket-level ping for transport keepalive
            // (proxies/load balancers), but it does not affect liveness.
            client.ping();
            sendTracked(client, { type: "ping" });
          }
        }
      }, heartbeatIntervalMs);
      // Don't keep the event loop alive solely for the heartbeat.
      heartbeat.unref?.();
    }

    wss.once("error", reject);

    wss.once("listening", () => {
      wss.off("error", reject);
      const address = wss.address() as AddressInfo;
      resolve({
        wss,
        port: address.port,
        rooms,
        rpc,
        sessions,
        registerRpc: (method, handler) => {
          rpc.register(method, handler);
        },
        broadcast,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            if (heartbeat) {
              clearInterval(heartbeat);
            }
            for (const client of wss.clients) {
              client.terminate();
            }
            wss.close((err) => {
              if (err) {
                rejectClose(err);
              } else {
                resolveClose();
              }
            });
          }),
      });
    });
  });
}
