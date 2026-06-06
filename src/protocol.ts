/**
 * Typed JSON message protocol for the WebSocket server.
 *
 * Every message exchanged over the wire is a JSON object of the shape
 * `{ type, room?, data? }`. The `type` field discriminates the message
 * kind; `room` and `data` carry the payload.
 */

/** Message kinds understood by the server and emitted to clients. */
export type MessageType =
  | "join"
  | "leave"
  | "message"
  | "joined"
  | "left"
  | "error";

/**
 * A protocol message. `room` is required for room-scoped messages
 * (`join`, `leave`, `message`, `joined`, `left`) and omitted for
 * connection-level messages such as `error`.
 */
export interface ProtocolMessage<T = unknown> {
  type: MessageType;
  room?: string;
  data?: T;
}

/** Type guard that validates an unknown value is a well-formed protocol message. */
export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string") {
    return false;
  }
  const validTypes: MessageType[] = [
    "join",
    "leave",
    "message",
    "joined",
    "left",
    "error",
  ];
  if (!validTypes.includes(candidate.type as MessageType)) {
    return false;
  }
  if (candidate.room !== undefined && typeof candidate.room !== "string") {
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
