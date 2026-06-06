import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type ServerHandle } from "./server.js";
import { decode, encode, type ProtocolMessage } from "./protocol.js";

/**
 * A test client that buffers every inbound message from the moment the
 * socket is created. This avoids races where the server's `welcome` (or
 * any other frame) arrives before a one-shot listener is attached.
 */
class TestClient {
  readonly ws: WebSocket;
  private readonly inbox: ProtocolMessage[] = [];
  private readonly waiters: Array<{
    match: (m: ProtocolMessage) => boolean;
    resolve: (m: ProtocolMessage) => void;
  }> = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on("message", (raw) => {
      let msg: ProtocolMessage;
      try {
        msg = decode(raw.toString());
      } catch {
        return;
      }
      const idx = this.waiters.findIndex((w) => w.match(msg));
      if (idx >= 0) {
        const [w] = this.waiters.splice(idx, 1);
        w.resolve(msg);
      } else {
        this.inbox.push(msg);
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(message: ProtocolMessage): void {
    this.ws.send(encode(message));
  }

  /** Resolve with the next buffered/incoming message matching `type`. */
  waitFor(type: string): Promise<ProtocolMessage> {
    const match = (m: ProtocolMessage): boolean => m.type === type;
    const idx = this.inbox.findIndex(match);
    if (idx >= 0) {
      const [m] = this.inbox.splice(idx, 1);
      return Promise.resolve(m);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${type}`)),
        5000,
      );
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  /** True if any buffered message of `type` has been seen. */
  sawType(type: string): boolean {
    return this.inbox.some((m) => m.type === type);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

/** Open a buffering client and return it once the welcome has arrived. */
async function connectReady(
  port: number,
): Promise<[WebSocket, ProtocolMessage]> {
  const client = new TestClient(port);
  await client.open();
  const welcome = await client.waitFor("welcome");
  clients.push(client);
  return [client.ws, welcome];
}

/** Active buffering clients, looked up by their underlying ws. */
const clients: TestClient[] = [];

function clientFor(ws: WebSocket): TestClient {
  const c = clients.find((x) => x.ws === ws);
  if (!c) {
    throw new Error("no TestClient for this socket");
  }
  return c;
}

/** Resolve with the next message whose type is `type`, ignoring others. */
function waitFor(ws: WebSocket, type: string): Promise<ProtocolMessage> {
  return clientFor(ws).waitFor(type);
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

describe("createServer (anonymous, no auth required)", () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await createServer(0, { heartbeatIntervalMs: 0 });
  });

  afterEach(async () => {
    await server.close();
  });

  it("binds an ephemeral port when given 0", () => {
    expect(server.port).toBeGreaterThan(0);
  });

  it("greets a fresh connection with a welcome carrying a sessionId", async () => {
    const [ws, welcome] = await connectReady(server.port);
    expect(welcome.type).toBe("welcome");
    expect(typeof welcome.sessionId).toBe("string");
    expect(welcome.seq).toBe(1);
    await closeClient(ws);
  });

  it("broadcasts a room message to other members but not the sender", async () => {
    const [alice] = await connectReady(server.port);
    const [bob] = await connectReady(server.port);

    alice.send(encode({ type: "join", room: "chat" }));
    expect((await waitFor(alice, "joined")).room).toBe("chat");
    bob.send(encode({ type: "join", room: "chat" }));
    expect((await waitFor(bob, "joined")).room).toBe("chat");

    expect(server.rooms.members("chat")).toHaveLength(2);

    const received = waitFor(bob, "message");
    alice.send(encode({ type: "message", room: "chat", data: "hello" }));

    const msg = await received;
    expect(msg.room).toBe("chat");
    expect(msg.data).toBe("hello");

    await closeClient(alice);
    await closeClient(bob);
  });

  it("does not deliver to members of other rooms", async () => {
    const [alice] = await connectReady(server.port);
    const [bob] = await connectReady(server.port);

    alice.send(encode({ type: "join", room: "room-a" }));
    await waitFor(alice, "joined");
    bob.send(encode({ type: "join", room: "room-b" }));
    await waitFor(bob, "joined");

    alice.send(encode({ type: "message", room: "room-a", data: "x" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(clientFor(bob).sawType("message")).toBe(false);

    await closeClient(alice);
    await closeClient(bob);
  });

  it("removes a client from rooms on leave", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "join", room: "temp" }));
    await waitFor(client, "joined");
    expect(server.rooms.members("temp")).toHaveLength(1);

    client.send(encode({ type: "leave", room: "temp" }));
    expect((await waitFor(client, "left")).room).toBe("temp");
    expect(server.rooms.members("temp")).toHaveLength(0);

    await closeClient(client);
  });

  it("retains room membership after a disconnect so the session can resume", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "join", room: "ghost" }));
    await waitFor(client, "joined");
    expect(server.rooms.members("ghost")).toHaveLength(1);

    await closeClient(client);
    await new Promise((r) => setTimeout(r, 50));
    // The session lives on (for resume); membership persists until TTL.
    expect(server.rooms.members("ghost")).toHaveLength(1);
  });

  it("reclaims room membership when the session is evicted", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "join", room: "evictme" }));
    await waitFor(client, "joined");
    expect(server.rooms.members("evictme")).toHaveLength(1);

    await closeClient(client);
    // Force eviction of all idle sessions via the store sweep with a TTL
    // of 0 by deleting through the public store API.
    for (const member of server.rooms.members("evictme")) {
      server.sessions.delete(member.id);
    }
    expect(server.rooms.members("evictme")).toHaveLength(0);
  });

  it("replies with an error on malformed input", async () => {
    const [client] = await connectReady(server.port);
    client.send("not json at all");
    const msg = await waitFor(client, "error");
    expect(msg.type).toBe("error");
    await closeClient(client);
  });

  it("server.broadcast delivers programmatically and counts recipients", async () => {
    const [a] = await connectReady(server.port);
    const [b] = await connectReady(server.port);
    a.send(encode({ type: "join", room: "api" }));
    await waitFor(a, "joined");
    b.send(encode({ type: "join", room: "api" }));
    await waitFor(b, "joined");

    const onA = waitFor(a, "message");
    const onB = waitFor(b, "message");
    const count = server.broadcast("api", { tick: 1 });
    expect(count).toBe(2);

    expect((await onA).data).toEqual({ tick: 1 });
    expect((await onB).data).toEqual({ tick: 1 });

    await closeClient(a);
    await closeClient(b);
  });

  it("tags outbound messages with a monotonically increasing seq", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "join", room: "seq" }));
    const joined = await waitFor(client, "joined");
    // welcome had seq 1; joined should be seq 2.
    expect(joined.seq).toBe(2);
    client.send(encode({ type: "leave", room: "seq" }));
    const left = await waitFor(client, "left");
    expect(left.seq).toBe(3);
    await closeClient(client);
  });
});

describe("authentication handshake", () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await createServer(0, {
      heartbeatIntervalMs: 0,
      authenticate: (token) => (token === "s3cret" ? "alice" : null),
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("rejects operations before auth when required", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "join", room: "vip" }));
    const err = await waitFor(client, "error");
    expect(err.data).toBe("authentication required");
    await closeClient(client);
  });

  it("accepts a valid token and reports the principal", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "auth", token: "s3cret" }));
    const authed = await waitFor(client, "authed");
    expect(authed.data).toBe("alice");

    client.send(encode({ type: "join", room: "vip" }));
    expect((await waitFor(client, "joined")).room).toBe("vip");
    await closeClient(client);
  });

  it("rejects an invalid token", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "auth", token: "wrong" }));
    const err = await waitFor(client, "error");
    expect(err.data).toBe("authentication failed");
    await closeClient(client);
  });

  it("uses the principal as the presence label", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "auth", token: "s3cret" }));
    await waitFor(client, "authed");
    client.send(encode({ type: "join", room: "team" }));
    await waitFor(client, "joined");
    expect(server.rooms.presence("team")).toEqual(["alice"]);
    await closeClient(client);
  });
});

describe("presence", () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await createServer(0, { heartbeatIntervalMs: 0 });
  });

  afterEach(async () => {
    await server.close();
  });

  it("reports the roster of a room", async () => {
    const [a] = await connectReady(server.port);
    const [b] = await connectReady(server.port);
    a.send(encode({ type: "auth", token: "amy" }));
    await waitFor(a, "authed");
    b.send(encode({ type: "auth", token: "ben" }));
    await waitFor(b, "authed");

    a.send(encode({ type: "join", room: "lounge" }));
    await waitFor(a, "joined");
    b.send(encode({ type: "join", room: "lounge" }));
    await waitFor(b, "joined");

    a.send(encode({ type: "presence", room: "lounge" }));
    const roster = await waitFor(a, "presence");
    expect(roster.room).toBe("lounge");
    expect(roster.members).toEqual(["amy", "ben"]);

    await closeClient(a);
    await closeClient(b);
  });

  it("returns an empty roster for an unknown room", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "presence", room: "void" }));
    const roster = await waitFor(client, "presence");
    expect(roster.members).toEqual([]);
    await closeClient(client);
  });
});

describe("rate limiting", () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await createServer(0, {
      heartbeatIntervalMs: 0,
      rateLimit: { capacity: 3, refillPerSecond: 0.001 },
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("rejects messages once the bucket is empty", async () => {
    const [client] = await connectReady(server.port);
    // Capacity 3: three presence queries succeed, the fourth is limited.
    for (let i = 0; i < 3; i += 1) {
      client.send(encode({ type: "presence", room: "r" }));
      await waitFor(client, "presence");
    }
    client.send(encode({ type: "presence", room: "r" }));
    const err = await waitFor(client, "error");
    expect(err.data).toBe("rate limit exceeded");
    await closeClient(client);
  });
});

describe("rpc", () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await createServer(0, { heartbeatIntervalMs: 0 });
    server.registerRpc("add", (params) => {
      const { a, b } = params as { a: number; b: number };
      return a + b;
    });
    server.registerRpc("whoami", (_params, ctx) => ctx.principal ?? "nobody");
    server.registerRpc("boom", () => {
      throw new Error("kaboom");
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("dispatches a method and returns the result", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "rpc", id: "1", method: "add", data: { a: 2, b: 3 } }));
    const result = await waitFor(client, "rpc_result");
    expect(result.id).toBe("1");
    expect(result.data).toBe(5);
    await closeClient(client);
  });

  it("exposes the principal via the rpc context", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "auth", token: "carol" }));
    await waitFor(client, "authed");
    client.send(encode({ type: "rpc", id: "2", method: "whoami" }));
    const result = await waitFor(client, "rpc_result");
    expect(result.data).toBe("carol");
    await closeClient(client);
  });

  it("returns rpc_error for unknown methods", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "rpc", id: "3", method: "nope" }));
    const err = await waitFor(client, "rpc_error");
    expect(err.id).toBe("3");
    expect(String(err.data)).toContain("unknown rpc method");
    await closeClient(client);
  });

  it("returns rpc_error when a handler throws", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "rpc", id: "4", method: "boom" }));
    const err = await waitFor(client, "rpc_error");
    expect(err.id).toBe("4");
    expect(err.data).toBe("kaboom");
    await closeClient(client);
  });

  it("requires an id on rpc requests", async () => {
    const [client] = await connectReady(server.port);
    client.send(encode({ type: "rpc", method: "add" }));
    const err = await waitFor(client, "error");
    expect(err.data).toBe("rpc requires an id");
    await closeClient(client);
  });
});

describe("reconnect / resume", () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await createServer(0, {
      heartbeatIntervalMs: 0,
      resumeBufferSize: 50,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("replays messages missed while disconnected", async () => {
    // Receiver establishes a session, joins a room, then drops.
    const [receiver, welcome] = await connectReady(server.port);
    const sessionId = welcome.sessionId as string;
    receiver.send(encode({ type: "join", room: "live" }));
    const joined = await waitFor(receiver, "joined");
    const lastSeq = joined.seq as number;

    // Sender joins the same room while the receiver is still connected.
    const [sender] = await connectReady(server.port);
    sender.send(encode({ type: "join", room: "live" }));
    await waitFor(sender, "joined");

    // Receiver drops without leaving the room.
    await closeClient(receiver);
    await new Promise((r) => setTimeout(r, 50));

    // While disconnected, the sender broadcasts. The message is buffered
    // on the receiver's (still-subscribed) session.
    server.broadcast("live", { important: true });

    // Receiver reconnects (new throwaway session + welcome) and resumes
    // its original session from its last seq.
    const [fresh] = await connectReady(server.port);
    fresh.send(encode({ type: "resume", sessionId, seq: lastSeq }));

    const resumed = await waitFor(fresh, "resumed");
    expect(resumed.sessionId).toBe(sessionId);

    const replayed = await waitFor(fresh, "message");
    expect(replayed.data).toEqual({ important: true });

    await closeClient(fresh);
    await closeClient(sender);
  });

  it("keeps the fresh session and errors when the sessionId is unknown", async () => {
    const [fresh, welcome] = await connectReady(server.port);
    expect(welcome.sessionId).toBeDefined();
    expect(welcome.sessionId).not.toBe("does-not-exist");
    fresh.send(encode({ type: "resume", sessionId: "does-not-exist", seq: 0 }));
    const err = await waitFor(fresh, "error");
    expect(String(err.data)).toContain("cannot resume");
    await closeClient(fresh);
  });
});

describe("heartbeat", () => {
  it("terminates a client that ignores application-level pings", async () => {
    const server = await createServer(0, { heartbeatIntervalMs: 40 });
    try {
      // This client never replies to `{ type: "ping" }`, so the server
      // should mark it dead and terminate it within ~2 intervals.
      const [client] = await connectReady(server.port);
      const closed = new Promise<void>((resolve) => {
        client.once("close", () => resolve());
      });
      await Promise.race([
        closed,
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error("not terminated")), 2000),
        ),
      ]);
      expect(client.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await server.close();
    }
  });

  it("keeps a client that replies to pings alive", async () => {
    const server = await createServer(0, { heartbeatIntervalMs: 40 });
    try {
      const [ws] = await connectReady(server.port);
      // Reply to every application-level ping with a pong.
      ws.on("message", (raw) => {
        let msg: ProtocolMessage;
        try {
          msg = decode(raw.toString());
        } catch {
          return;
        }
        if (msg.type === "ping") {
          ws.send(encode({ type: "pong" }));
        }
      });
      await new Promise((r) => setTimeout(r, 250));
      expect(ws.readyState).toBe(WebSocket.OPEN);
      await closeClient(ws);
    } finally {
      await server.close();
    }
  });
});
