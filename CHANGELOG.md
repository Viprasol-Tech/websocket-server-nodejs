# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/); versioning
follows [SemVer](https://semver.org/).

## [0.2.0] - 2025

### Added
- **Authentication handshake.** Connections can be gated behind an `auth`
  message; pluggable `authenticate(token)` resolves a principal that becomes
  the connection identity and presence label.
- **Heartbeats with dead-client cleanup.** The server pings on a configurable
  interval (protocol-level and WebSocket-level) and terminates clients that
  miss two consecutive beats.
- **Presence.** Query `presence` for a room to receive the sorted, de-duplicated
  roster of principals currently in it.
- **Per-connection rate limiting.** A token-bucket limiter throttles inbound
  messages per connection; configurable capacity and refill rate, or disable.
- **Request/response (RPC).** Register named methods and call them with
  `{ type: "rpc", id, method, data }`; replies are correlated via `id` and
  returned as `rpc_result` / `rpc_error`.
- **Reconnect / resume.** Every connection is assigned a resumable session with
  a bounded replay buffer. A reconnecting client sends `resume` with its
  `sessionId` and last `seq` to replay messages it missed.
- New exported modules: `TokenBucket`, `RpcRegistry`, `RpcMethodNotFoundError`,
  `Session`, `SessionStore`, plus presence helpers on `RoomManager`.
- Greatly expanded test suite (protocol, rooms, rate limiter, RPC, sessions,
  and real `ws`-client integration tests for every server feature).

### Changed
- Outbound server messages now carry a monotonic per-session `seq`.
- Fresh connections receive a `welcome` message carrying their `sessionId`.
- Protocol expanded with `auth`, `authed`, `welcome`, `ping`, `pong`,
  `presence`, `rpc`, `rpc_result`, `rpc_error`, `resume`, and `resumed`.

## [0.1.0] - 2025

### Added
- Initial release of websocket-server-nodejs: WebSocket server in Node/TypeScript with rooms and a typed JSON message protocol.
