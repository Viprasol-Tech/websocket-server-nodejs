/**
 * Request/response (RPC) support over the WebSocket protocol.
 *
 * A client sends `{ type: "rpc", id, method, data }` and the server
 * replies with either `{ type: "rpc_result", id, data }` or
 * `{ type: "rpc_error", id, data }`. The `id` correlates the response
 * with the request so multiple in-flight calls can be multiplexed over
 * a single connection.
 */

/** Context passed to an RPC handler describing the calling connection. */
export interface RpcContext {
  /** The authenticated principal for the connection, if any. */
  readonly principal: string | undefined;
  /** Stable id of the connection's resumable session. */
  readonly sessionId: string;
}

/**
 * An RPC handler. Receives the request `params` and a {@link RpcContext},
 * and returns a JSON-serializable result (sync or async). Throwing (or
 * rejecting) produces an `rpc_error` reply carrying the error message.
 */
export type RpcHandler = (
  params: unknown,
  context: RpcContext,
) => unknown | Promise<unknown>;

/** Raised by the RPC layer when a requested method is not registered. */
export class RpcMethodNotFoundError extends Error {
  constructor(method: string) {
    super(`unknown rpc method: ${method}`);
    this.name = "RpcMethodNotFoundError";
  }
}

/**
 * A registry of named RPC methods.
 *
 * Methods are registered up front (typically when the server is created)
 * and dispatched by name when an `rpc` message arrives.
 */
export class RpcRegistry {
  private readonly handlers = new Map<string, RpcHandler>();

  /**
   * Register `handler` under `method`.
   *
   * @throws {Error} if a handler is already registered for `method`.
   */
  register(method: string, handler: RpcHandler): this {
    if (this.handlers.has(method)) {
      throw new Error(`rpc method already registered: ${method}`);
    }
    this.handlers.set(method, handler);
    return this;
  }

  /** Whether a handler exists for `method`. */
  has(method: string): boolean {
    return this.handlers.has(method);
  }

  /** The names of all registered methods. */
  methods(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Dispatch a call to `method` with `params`.
   *
   * @throws {RpcMethodNotFoundError} if the method is not registered.
   * @throws any error thrown by the handler.
   */
  async dispatch(
    method: string,
    params: unknown,
    context: RpcContext,
  ): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) {
      throw new RpcMethodNotFoundError(method);
    }
    return handler(params, context);
  }
}
