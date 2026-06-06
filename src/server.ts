import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { RoomManager } from "./rooms.js";
import { decode, encode, type ProtocolMessage } from "./protocol.js";

/** Options for {@link createServer}. */
export interface ServerOptions {
  /**
   * Host interface to bind. Defaults to `127.0.0.1`. Pass `0.0.0.0`
   * to listen on all interfaces.
   */
  host?: string;
  /** Optional hook invoked for every successfully parsed inbound message. */
  onMessage?: (socket: WebSocket, message: ProtocolMessage) => void;
}

/** Handle returned by {@link createServer} for inspecting and stopping the server. */
export interface ServerHandle {
  /** The underlying `ws` server instance. */
  readonly wss: WebSocketServer;
  /** The actual TCP port the server is listening on (resolved even for port 0). */
  readonly port: number;
  /** The room membership manager backing this server. */
  readonly rooms: RoomManager;
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

function send(socket: WebSocket, message: ProtocolMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(encode(message));
  }
}

/**
 * Start a WebSocket server on `port`.
 *
 * Pass `0` to bind an ephemeral port (useful for tests); the resolved
 * port is available on the returned handle's `port` property.
 *
 * The server speaks the typed JSON protocol from `./protocol`:
 *   - `{ type: "join", room }`    -> adds the client to the room, replies `{ type: "joined", room }`
 *   - `{ type: "leave", room }`   -> removes the client, replies `{ type: "left", room }`
 *   - `{ type: "message", room, data }` -> broadcasts to all other room members
 *
 * Malformed payloads receive an `{ type: "error", data }` reply.
 */
export function createServer(
  port: number,
  options: ServerOptions = {},
): Promise<ServerHandle> {
  const { host = "127.0.0.1", onMessage } = options;
  const rooms = new RoomManager();

  return new Promise<ServerHandle>((resolve, reject) => {
    const wss = new WebSocketServer({ port, host });

    const broadcast = (
      room: string,
      data: unknown,
      exclude?: WebSocket,
    ): number => {
      let delivered = 0;
      for (const member of rooms.members(room)) {
        if (member === exclude) {
          continue;
        }
        send(member, { type: "message", room, data });
        delivered += 1;
      }
      return delivered;
    };

    wss.on("connection", (socket: WebSocket) => {
      socket.on("message", (raw) => {
        let message: ProtocolMessage;
        try {
          message = decode(raw.toString());
        } catch (err) {
          send(socket, {
            type: "error",
            data: err instanceof Error ? err.message : "decode error",
          });
          return;
        }

        onMessage?.(socket, message);

        switch (message.type) {
          case "join": {
            if (!message.room) {
              send(socket, { type: "error", data: "join requires a room" });
              return;
            }
            rooms.join(message.room, socket);
            send(socket, { type: "joined", room: message.room });
            break;
          }
          case "leave": {
            if (!message.room) {
              send(socket, { type: "error", data: "leave requires a room" });
              return;
            }
            rooms.leave(message.room, socket);
            send(socket, { type: "left", room: message.room });
            break;
          }
          case "message": {
            if (!message.room) {
              send(socket, { type: "error", data: "message requires a room" });
              return;
            }
            broadcast(message.room, message.data, socket);
            break;
          }
          default: {
            send(socket, {
              type: "error",
              data: `unsupported message type: ${message.type}`,
            });
          }
        }
      });

      socket.on("close", () => {
        rooms.leaveAll(socket);
      });
      socket.on("error", () => {
        rooms.leaveAll(socket);
      });
    });

    wss.once("error", reject);

    wss.once("listening", () => {
      wss.off("error", reject);
      const address = wss.address() as AddressInfo;
      resolve({
        wss,
        port: address.port,
        rooms,
        broadcast,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
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
