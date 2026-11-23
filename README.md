# The agent Chrome extension

Screen pops for agents. When the agent's call reaches a point that has a
screen, the extension opens it in a new tab. It also shows the call state and
the agent's availability in the toolbar popup.

It replaces the Angular 11 build (`voipappz/chrome`) with React 19, Vite,
MUI 7 and CRXJS. The behaviour is unchanged, ported one-for-one. The plan and
open work are in [PLAN.md](PLAN.md).

## Commands

Node 22 comes from `mise.toml`; every target runs through `mise exec`.

| Target | What it does |
| --- | --- |
| `make setup` | Installs node, the dependencies and Chromium for the e2e specs. |
| `make build` | Builds into `dist/`. In `chrome://extensions`, turn on Developer mode, then **Load unpacked** that folder. |
| `make dev` | Keeps `dist/` live (HMR inside the extension). The popup also opens as a plain page at <http://localhost:5175/index.html>. |
| `make test` | Lint, unit tests, then the offline e2e specs in a real Chrome. CI (`.github/workflows/ci.yml`) runs the same. |
| `make e2e SPEC=login` | One Playwright spec; see the table at the end for the env the live ones need. |
| `make pack` | Zips `dist/` to `extension-build.zip`. `EXT_VERSION=0.0.11` overrides the version. Nothing is published. |

## How it works

```
popup (index.html)            service worker (background.js)        server
  login  ── POST /auth/user_login ─────────────────────────────────▶  API
  main   ── runtime port {event:"login", token} ─▶ WebSocket ──────▶  node /cable (ActionCable)
         ◀── {event:"realtime"|"call"} ──────────  ◀── Notifications ──  ◀── NATS
                                                   tab:new → chrome.tabs.create(url)
```

- **The popup** signs in at the API and stores the session in its
  `localStorage` (`_token`, `_id`, `_domain`; see `src/session.js`). Then it
  hands the session to the worker over a runtime port. The worker has no
  storage of its own.
- **The worker** holds one ActionCable socket to the node, with the login
  token, and subscribes to `Notifications` and `StateChannel`. On a `tab:new`
  notification it opens the tab. Call events and the connection state go to
  any open popup, and nothing is persisted. Protocol:
  [CABLE_CONTRACT.md](CABLE_CONTRACT.md).
- **Why cable, not NATS directly:** cable admits the socket with the agent's
  own token and streams only that agent's notifications. NATS checks a fixed
  username and password, which a Chrome extension cannot keep secret. Cable is
  NATS-backed, so the events are the same.
- **The hosts** are `CONFIG.API_ENDPOINT` and `CONFIG.CABLE_URL` (empty means
  `<API>/cable`) in `src/config.js`. `localStorage._domain` and `_cable`
  override them at runtime; that is how the e2e specs aim at a fake node.

The popup's theme (`src/popup/theme.js`) keeps the indigo look of the Angular
build, with an Emotion cache that mirrors styles for the Hebrew main page.

## e2e specs (`tests/e2e`)

| Spec | Needs |
| --- | --- |
| `mock-realtime` | Nothing. A fake HTTPS node with `/auth/user_login` and `/cable`, started by the spec. |
| `login`, `user-connect` | `TEST_DOMAIN`, `TEST_USERNAME`, `TEST_PASSWORD`. The USER login (users table), not the account one. |
| `real-receive` | `TEST_RECEIVE=1`, driven by a shell harness. |

```
make e2e SPEC=login TEST_DOMAIN=https://switch.voipappz.io TEST_USERNAME=... TEST_PASSWORD=...
```

## Releases

`make release VERSION=0.0.11` tags `v0.0.11` and pushes it. The Release workflow builds that version (it is stamped into the manifest), runs the unit tests, the offline e2e (including a real browser restart) and the live check against `wss://switch.voipappz.io/cable`, then publishes a GitHub Release with one zip per customer (`voipappz-extension-0.0.11.zip`, `nimbus-extension-0.0.11.zip`). Install: unzip, `chrome://extensions` → Developer mode → Load unpacked. Not published to the Chrome Web Store.

## Customers

One build per customer, from `src/customers.js`: `EXT_CUSTOMER=nimbus make build` (default `voipappz`). It sets where the extension logs in, its cable, and its name (`Nimbus14`, `VoipAppz14`). Add a customer there; CI and releases build and check each one against its own server.
