# Realtime contract — `/ws/events`

What a browser client and a realtime server must agree on. Written down because
the server is expected to change — it is a Deno BFF today (`voipappz/app`) and
may be an Elixir application later — while the clients should not have to.

Everything here was read out of the working Deno implementation, not designed
fresh. Where a detail exists for a non-obvious reason, the reason is given: those
are the parts an independent implementation gets wrong.

## Scope

This is the contract for **pushing per-user events to a browser**. It is not a
transport for backend services: those subscribe to NATS or the cable server
directly and are unaffected by anything here.

Clients today: the Chrome extension (screen pop, call state, agent state).

## Handshake

```
GET /ws/events            Upgrade: websocket
Sec-WebSocket-Protocol:   voipappz-bearer.<base64url(jwt)>
```

The token travels as a **subprotocol**, not a query parameter. Browsers cannot
set `Authorization` on a WebSocket handshake, and a URL is recorded verbatim by
every reverse proxy and access log in the path — a query parameter leaks the
credential into infrastructure nobody audits. The encoding is base64url,
unpadded: `+`→`-`, `/`→`_`, no `=`. The server echoes the protocol back when
accepting.

`Authorization: Bearer <jwt>` is also accepted, for non-browser clients.

A connection offering neither is refused.

## Authorization

The token is the one the user already holds from `POST /auth/user_login`.
Nothing is minted for realtime, and there is no second credential to keep in
sync — a shared secret between the realtime server and the issuer is exactly the
thing that has silently drifted in the past.

Validation is delegated: the server calls the mothership (`ENGINE_URL`) at
`/api/features`, which runs `auth_user!`. A 2xx means the token is a live user.
Results are cached — briefly on success, more briefly on failure — with a
bounded number of entries.

**Which streams a connection receives is derived from that token's claims**
(`user_uuid`, `environment_uuid`, account). A client never names a uuid, and a
server must never accept one from a client. This is the whole security model:
the alternative — trusting a client-supplied id — is a defect that has existed
elsewhere in this system, where any valid token could stream any other user's
events.

## Frames — server to client

```jsonc
// on open
{"type":"welcome","ts":"…","subscribed":[],"clients":1,"cable_ready":true}

// a user notification (screen pop, call redirect, …) — `message` verbatim
{"type":"notification","message":{…}}

// the user's own state, already folded (see below)
{"type":"user.state","user_uuid":"…","event":"user.ringing","at":1690000000,
 "view":{…},"message":{…}}

// tenant-wide dashboard values, coalesced
{"type":"dashboard.live","ts":"…","payload":{…}}

// acknowledgements for topic subscriptions
{"type":"subscribed","topic":"…","subscribed":["…"]}
{"type":"unsubscribed","topic":"…","subscribed":["…"]}
```

Every frame carries `type`. A client dispatches on it and ignores what it does
not know, so a server may add frame types without breaking existing clients.

## Frames — client to server

```jsonc
{"action":"subscribe","topic":"call.*"}
{"action":"unsubscribe","topic":"call.*"}
```

Topics use RabbitMQ-style matching and address the general event bus. The
per-user streams above need no subscription: they follow from the token.

## Server obligations

These are behaviours, not shapes, and they are where a reimplementation drifts.

**Fold state before sending it.** The node publishes one named event per
transition and stores no totals, so a raw relay leaves every client to
accumulate deltas — and none of them do. `view` is the accumulated snapshot, so
a reconnecting tab gets a whole picture rather than the next delta. `message`
still carries the raw document for clients that want it.

**Never route per-user frames through a shared broadcast.** A fan-out that
reaches all subscribers regardless of identity is how one tenant's data lands in
another tenant's browser.

**Apply backpressure.** A slow or closing browser must not grow the server's
outbound queue. Drop frames when the socket's buffered bytes exceed a cap, and
count the drops — silent loss is worse than visible loss.

**Coalesce bursty streams.** Dashboard values merge within a window rather than
sending every intermediate value.

**Subscribing upstream is the registration.** The node stamps
`user:<uuid>:logged_in_at` when a subscription lands, so opening this connection
is what marks an agent online. A server that lazily defers its upstream
subscription changes user-visible presence.

## Deliberately unspecified

How the server obtains events. Today the Deno BFF is an ActionCable client of
the va-crystal node and also subscribes to NATS. An implementation may consume
either, both, or something else — clients cannot tell and must not care.

One detail worth not copying: the Deno implementation opens one upstream cable
connection **per browser client**. That is a reasonable shape for its runtime
and a poor one for a BEAM application, where a single upstream consumer fanning
out over `Phoenix.PubSub` per-user topics — with `Presence` supplying `clients`
— does the same job with far less upstream load.

## Conformance checklist

- [ ] Refuses a connection with no bearer subprotocol and no `Authorization`
- [ ] Accepts base64url without padding
- [ ] Rejects a token the mothership does not authenticate
- [ ] Ignores any uuid supplied by the client
- [ ] Sends `welcome` before any data frame
- [ ] `notification.message` is the upstream payload untouched
- [ ] `user.state.view` is folded, not raw deltas
- [ ] Two connections for different users never see each other's frames
- [ ] Drops rather than queues for a stalled client, and counts it
