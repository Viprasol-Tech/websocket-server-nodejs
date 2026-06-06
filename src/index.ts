/**
 * websocket-server-nodejs
 *
 * A small, typed WebSocket server with rooms, an authentication
 * handshake, heartbeats with dead-client cleanup, presence rosters,
 * per-connection rate limiting, request/response (RPC), and a
 * reconnect/resume protocol. Built and maintained by Viprasol Tech.
 */
export { createServer } from "./server.js";
export type {
  ServerHandle,
  ServerOptions,
  AuthenticateFn,
} from "./server.js";
export { RoomManager } from "./rooms.js";
export { TokenBucket } from "./rate-limiter.js";
export type { TokenBucketOptions } from "./rate-limiter.js";
export {
  RpcRegistry,
  RpcMethodNotFoundError,
} from "./rpc.js";
export type { RpcHandler, RpcContext } from "./rpc.js";
export { Session, SessionStore } from "./session.js";
export type { SessionOptions, BufferedMessage } from "./session.js";
export {
  encode,
  decode,
  isProtocolMessage,
  isClientMessageType,
} from "./protocol.js";
export type {
  ProtocolMessage,
  MessageType,
  ClientMessageType,
  ServerMessageType,
} from "./protocol.js";
