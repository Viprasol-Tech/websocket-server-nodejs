/**
 * Typed JSON message protocol for the WebSocket server.
 *
 * Every message exchanged over the wire is a JSON object whose `type`
 * field discriminates the message kind. The protocol covers room
 * messaging, an authentication handshake, heartbeats, presence,
 * request/response (RPC), and a reconnect/resume flow.
 */

/** Message kinds sent by clients to the server. */
export type ClientMessageType =
  | "auth"
  | "join"
  | "leave"
  | "message"
  | "ping"
  | "pong"
  | "presence"
  | "rpc"
  | "resume";

/** Message kinds emitted by the server to clients. */
export type ServerMessageType =
  | "welcome"
  | "authed"
  | "joined"
  | "left"
  | "message"
  | "ping"
  | "pong"
  | "presence"
  | "rpc_result"
  | "rpc_error"
  | "resumed"
  | "error";

/** Union of every message kind that can appear on the wire. */
export type MessageType = ClientMessageType | ServerMessageType;

/**
 * A protocol message.
 *
 * - `room` scopes room operations (`join`, `leave`, `message`, ...).
 * - `data` carries an arbitrary JSON payload.
 * - `id` correlates an `rpc` request with its `rpc_result`/`rpc_error`.
 * - `method` names the RPC procedure for `rpc` requests.
 * - `token` carries the credential for `auth`.
 * - `seq` is a monotonic per-connection sequence number used by the
 *   resume protocol to detect and replay missed messages.
 * - `sessionId` identifies a resumable session for the `resume` flow.
 * - `members` is the presence roster returned for a `presence` query.
 */
export interface ProtocolMessage<T = unknown> {
  type: MessageType;
  room?: string;
  data?: T;
  id?: string;
  method?: string;
  token?: string;
  seq?: number;
  sessionId?: string;
  members?: string[];
}

const CLIENT_TYPES = new Set<string>([
  "auth",
  "join",
  "leave",
  "message",
  "ping",
  "pong",
  "presence",
  "rpc",
  "resume",
]);

const SERVER_TYPES = new Set<string>([
  "welcome",
  "authed",
  "joined",
  "left",
  "message",
  "ping",
  "pong",
  "presence",
  "rpc_result",
  "rpc_error",
  "resumed",
  "error",
]);

const ALL_TYPES = new Set<string>([...CLIENT_TYPES, ...SERVER_TYPES]);

/** Type guard: is `value` one of the client-originating message kinds? */
export function isClientMessageType(value: string): value is ClientMessageType {
  return CLIENT_TYPES.has(value);
}

/** Type guard that validates an unknown value is a well-formed protocol message. */
export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string" || !ALL_TYPES.has(candidate.type)) {
    return false;
  }
  if (candidate.room !== undefined && typeof candidate.room !== "string") {
    return false;
  }
  if (candidate.id !== undefined && typeof candidate.id !== "string") {
    return false;
  }
  if (candidate.method !== undefined && typeof candidate.method !== "string") {
    return false;
  }
  if (candidate.token !== undefined && typeof candidate.token !== "string") {
    return false;
  }
  if (candidate.sessionId !== undefined && typeof candidate.sessionId !== "string") {
    return false;
  }
  if (candidate.seq !== undefined && typeof candidate.seq !== "number") {
    return false;
  }
  if (
    candidate.members !== undefined &&
    !(
      Array.isArray(candidate.members) &&
      candidate.members.every((m) => typeof m === "string")
    )
  ) {
    return false;
  }
  return true;
}

/** Serialize a protocol message to a JSON string suitable for `ws.send`. */
export function encode<T>(message: ProtocolMessage<T>): string {
  return JSON.stringify(message);
}

/**
 * Parse a raw wire payload into a protocol message.
 *
 * @throws {Error} if the payload is not valid JSON or not a valid
 * protocol message.
 */
export function decode(raw: string): ProtocolMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON payload");
  }
  if (!isProtocolMessage(parsed)) {
    throw new Error("payload is not a valid protocol message");
  }
  return parsed;
}
