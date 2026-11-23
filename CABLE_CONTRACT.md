# Cable contract

How the extension talks to a node's ActionCable (va-crystal, `/cable`). The same
client the Angular build had (`voipappz/chrome@c3df82b`); `src/cable.js` holds
the pure half and is unit-tested.

## Handshake

```
GET <CABLE_URL>?token=<login token>     Upgrade: websocket
Sec-WebSocket-Protocol: actioncable-v1-json
```

- `CABLE_URL` is `wss://<API host>/cable` unless `CONFIG.CABLE_URL` (or
  `localStorage._cable`) names another; the scheme follows the API's.
- The token is the one `POST /auth/user_login` returned. Browsers cannot set
  headers on a WebSocket handshake, so it goes in the query, as the app's own
  cable client does. It is masked in every log line.
- The subprotocol is required: without it the server drops the socket before
  `welcome`, which looks exactly like a bad token.
- A refused token gets `{"type":"disconnect","reason":"unauthorized","reconnect":false}`;
  the worker then stops retrying until the next login.

## After `welcome`

Nothing is sent before it. Then the worker subscribes:

```jsonc
{"command":"subscribe","identifier":"{\"channel\":\"Notifications\",\"user_uuid\":\"<uuid>\"}"}
{"command":"subscribe","identifier":"{\"channel\":\"StateChannel\",\"scope\":\"user\",\"id\":\"<uuid>\"}"}
```

- **Notifications** streams the user verified by the token. Current nodes
  ignore `user_uuid`; it is sent for older nodes, which pick the stream from it.
- The server answers `confirm_subscription` or `reject_subscription` with the
  identifier echoed verbatim; data frames carry it too, so frames are routed by
  the exact identifier string.
- Anything published before `confirm_subscription` is not delivered (no
  replay), which is why the light turns green only on that confirmation.

## Liveness

The server pings every 3s. Two missed pings (7s) and the socket is treated as
dead and reopened; any close reopens after 3s. Incoming traffic also keeps the
MV3 service worker alive (Chrome 116+).

## Notification payloads

`message` on the Notifications subscription is routed by `src/realtime.js`:

| Payload | Effect |
|---|---|
| `{action:"tab:new", url}` | opens `url` in a new tab (the screen pop) |
| `{action:"call:ringing"\|"call:answer"\|"call:hangup", call}` | updates the popup's call card |
| `{type:"agent", message:{type:"ringing"\|"answer"\|"hangup", call, screen}}` | the same, current shape |
| anything else | passed to any open popup |
