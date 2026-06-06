<div align="center">
  <img src="docs/assets/logo.png" alt="Viprasol Tech" width="120" />

  <h1>websocket-server-nodejs</h1>

  <p><strong>A typed WebSocket server for Node.js with rooms and a JSON message protocol.</strong></p>

  <p><em>Built and maintained by Viprasol Tech.</em></p>

  <p>
    <a href="https://github.com/Viprasol-Tech/websocket-server-nodejs/actions"><img src="https://github.com/Viprasol-Tech/websocket-server-nodejs/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript strict" />
  </p>
</div>

---

## Features

- **Rooms** — clients can join and leave arbitrary string-keyed rooms; membership is tracked bidirectionally so disconnects are cleaned up automatically.
- **Broadcast** — deliver a message to every member of a room, with optional sender exclusion, and get the recipient count back.
- **Typed JSON protocol** — every message is a `{ type, room?, data? }` object, with encode/decode helpers and a runtime type guard.
- **Ephemeral ports** — pass port `0` and read the resolved port from the handle (ideal for tests).
- **Graceful shutdown** — `close()` terminates live connections and resolves once the listener is fully closed.
- **Strict TypeScript** — ships type declarations; built on the battle-tested [`ws`](https://github.com/websockets/ws) library.

## Install

```bash
npm install websocket-server-nodejs ws
```

## Usage

```ts
import { createServer, encode } from "websocket-server-nodejs";

// Start a server (port 0 = ephemeral; use a fixed port in production).
const server = await createServer(8080);
console.log(`listening on ${server.port}`);

// The server understands the JSON protocol out of the box:
//   { type: "join",    room }            -> ack { type: "joined", room }
//   { type: "leave",   room }            -> ack { type: "left",   room }
//   { type: "message", room, data }      -> broadcast to other room members

// You can also broadcast programmatically from your own code:
const recipients = server.broadcast("lobby", { hello: "world" });
console.log(`delivered to ${recipients} clients`);

// Shut down cleanly when done.
await server.close();
```

A minimal client using the `ws` package:

```ts
import { WebSocket } from "ws";
import { encode, decode } from "websocket-server-nodejs";

const ws = new WebSocket("ws://127.0.0.1:8080");
ws.on("open", () => {
  ws.send(encode({ type: "join", room: "lobby" }));
  ws.send(encode({ type: "message", room: "lobby", data: "hi all" }));
});
ws.on("message", (raw) => {
  const msg = decode(raw.toString());
  console.log(msg.type, msg.room, msg.data);
});
```

## API

### `createServer(port, options?) => Promise<ServerHandle>`

Starts a WebSocket server. Pass `0` for an ephemeral port. `options` accepts an optional `host` (defaults to `127.0.0.1`) and an `onMessage(socket, message)` hook invoked for every successfully parsed inbound message.

### `ServerHandle`

| Member | Description |
| --- | --- |
| `port` | The resolved TCP port (always concrete, even for port `0`). |
| `wss` | The underlying `ws` `WebSocketServer`. |
| `rooms` | The `RoomManager` backing the server. |
| `broadcast(room, data, exclude?)` | Sends a `message` to all room members (minus `exclude`); returns the delivery count. |
| `close()` | Terminates connections and stops listening; resolves when closed. |

### `RoomManager`

Standalone room-membership bookkeeping: `join`, `leave`, `leaveAll`, `members`, `roomsOf`, and `roomCount`.

### Protocol helpers

`encode(message)`, `decode(raw)` (throws on malformed input), and `isProtocolMessage(value)` for runtime validation. Message types: `join`, `leave`, `message`, `joined`, `left`, `error`.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc -> dist/
```

## Contributing

Contributions are welcome. Please open an issue to discuss substantial changes first, keep the build green (`npm run typecheck && npm test`), and follow the existing code style. See [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## Contact — Viprasol Tech Private Limited

- Website: [viprasol.com](https://viprasol.com)
- Email: [support@viprasol.com](mailto:support@viprasol.com)
- Telegram: [t.me/viprasol_help](https://t.me/viprasol_help) | WhatsApp: +91 96336 52112
- GitHub: [@Viprasol-Tech](https://github.com/Viprasol-Tech) | [LinkedIn](https://www.linkedin.com/in/viprasol/) | X [@viprasol](https://twitter.com/viprasol)

## License

[MIT](LICENSE) (c) 2025 Viprasol Tech Private Limited
