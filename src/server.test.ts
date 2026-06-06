import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type ServerHandle } from "./server.js";
import { decode, encode, type ProtocolMessage } from "./protocol.js";

/** Connect a real ws client and resolve once the socket is open. */
function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Resolve with the next protocol message received on `ws`. */
function nextMessage(ws: WebSocket): Promise<ProtocolMessage> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => {
      try {
        resolve(decode(raw.toString()));
      } catch (err) {
        reject(err);
      }
    });
    ws.once("error", reject);
  });
}

function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once("close", () => resolve());
    ws.close();
  });
}

describe("createServer", () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await createServer(0);
  });

  afterEach(async () => {
    await server.close();
  });

  it("binds an ephemeral port when given 0", () => {
    expect(server.port).toBeGreaterThan(0);
  });

  it("broadcasts a room message to other members but not the sender", async () => {
    const alice = await connect(server.port);
    const bob = await connect(server.port);

    // Both join the same room and await the ack.
    alice.send(encode({ type: "join", room: "chat" }));
    expect((await nextMessage(alice)).type).toBe("joined");

    bob.send(encode({ type: "join", room: "chat" }));
    expect((await nextMessage(bob)).type).toBe("joined");

    expect(server.rooms.members("chat")).toHaveLength(2);

    // Bob listens for the broadcast; Alice sends it.
    const received = nextMessage(bob);
    alice.send(encode({ type: "message", room: "chat", data: "hello" }));

    const msg = await received;
    expect(msg.type).toBe("message");
    expect(msg.room).toBe("chat");
    expect(msg.data).toBe("hello");

    await closeClient(alice);
    await closeClient(bob);
  });

  it("does not deliver to members of other rooms", async () => {
    const alice = await connect(server.port);
    const bob = await connect(server.port);

    alice.send(encode({ type: "join", room: "room-a" }));
    await nextMessage(alice);
    bob.send(encode({ type: "join", room: "room-b" }));
    await nextMessage(bob);

    let bobGotSomething = false;
    bob.on("message", () => {
      bobGotSomething = true;
    });

    // broadcast helper reports zero deliveries to room-a (only alice, the sender excluded later)
    alice.send(encode({ type: "message", room: "room-a", data: "x" }));

    await new Promise((r) => setTimeout(r, 100));
    expect(bobGotSomething).toBe(false);

    await closeClient(alice);
    await closeClient(bob);
  });

  it("removes a client from rooms on leave", async () => {
    const client = await connect(server.port);
    client.send(encode({ type: "join", room: "temp" }));
    await nextMessage(client);
    expect(server.rooms.members("temp")).toHaveLength(1);

    client.send(encode({ type: "leave", room: "temp" }));
    expect((await nextMessage(client)).type).toBe("left");
    expect(server.rooms.members("temp")).toHaveLength(0);

    await closeClient(client);
  });

  it("cleans up room membership when a client disconnects", async () => {
    const client = await connect(server.port);
    client.send(encode({ type: "join", room: "ghost" }));
    await nextMessage(client);
    expect(server.rooms.members("ghost")).toHaveLength(1);

    await closeClient(client);
    // Give the server's close handler a tick to run.
    await new Promise((r) => setTimeout(r, 50));
    expect(server.rooms.members("ghost")).toHaveLength(0);
  });

  it("replies with an error on malformed input", async () => {
    const client = await connect(server.port);
    client.send("not json at all");
    const msg = await nextMessage(client);
    expect(msg.type).toBe("error");
    await closeClient(client);
  });

  it("server.broadcast delivers programmatically and counts recipients", async () => {
    const a = await connect(server.port);
    const b = await connect(server.port);
    a.send(encode({ type: "join", room: "api" }));
    await nextMessage(a);
    b.send(encode({ type: "join", room: "api" }));
    await nextMessage(b);

    const onA = nextMessage(a);
    const onB = nextMessage(b);
    const count = server.broadcast("api", { tick: 1 });
    expect(count).toBe(2);

    expect((await onA).data).toEqual({ tick: 1 });
    expect((await onB).data).toEqual({ tick: 1 });

    await closeClient(a);
    await closeClient(b);
  });
});
