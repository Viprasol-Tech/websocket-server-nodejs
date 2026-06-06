/**
 * websocket-server-nodejs
 *
 * A small, typed WebSocket server with room support and a JSON message
 * protocol. Built and maintained by Viprasol Tech.
 */
export { createServer } from "./server.js";
export type { ServerHandle, ServerOptions } from "./server.js";
export { RoomManager } from "./rooms.js";
export {
  encode,
  decode,
  isProtocolMessage,
  type ProtocolMessage,
  type MessageType,
} from "./protocol.js";
