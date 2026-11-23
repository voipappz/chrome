# Chrome extension: plan

The agent Chrome extension opens a screen-pop tab when the agent's call reaches
a point that has a screen. It is an end-customer build and lives in its
own repo, `connectix-io/chrome`. Its React port was first written inside
`voipappz/app`, then moved here.

Not in scope: publishing to the Chrome Web Store (decided: do not publish).

## Decided

- **Stack:** React 19, Vite 6, MUI 7, CRXJS 3, Vitest, Playwright. Node 22 comes from `mise.toml`.
- **Behaviour:** the same logic as the Angular build (`voipappz/chrome`).
- **Backend: no Elixir portal.** Login goes to the API (`/auth/user_login`). Realtime goes to the node's **cable** (`wss://<node>/cable`, ActionCable). Cable is safe now: the node's `Notifications` channel streams the user verified by the token and ignores any `user_uuid` the client sends (`va-crystal/node/realtime/app.cr`, `class Notifications`).

## Steps

### 1. The React port in its own repo (done)
- [x] Source, tests and docs; a local theme; `package.json`, Vite, ESLint, `mise.toml`, `Makefile`.
- [x] CI: lint, unit tests, build and the offline e2e in Chrome (`.github/workflows/ci.yml`).
- [ ] Load `dist/` in Chrome by hand and sign in with a real user.

### 2. Switch from the portal to the API and cable (done, branch `feat/cable`)
- [x] **Config:** `API_URL` (login and REST) and `CABLE_URL` (default `wss://<api host>/cable`), with `localStorage` overrides for tests, as `_domain` works today.
- [x] **Worker:** a small ActionCable client.
  - It sends the `actioncable-v1-json` subprotocol, puts the token in `?token=`, and waits for `welcome`.
  - It then subscribes to `{"channel":"Notifications"}` and to `{"channel":"StateChannel","scope":"user","id":<uuid>}`.
  - It routes `message` frames by `identifier`, honours `disconnect` with `reconnect:false`, and reconnects on close and on missed pings.
  - It can't be `@rails/actioncable`, which touches `document` and so can't run in a service worker. Port the client from `voipappz/chrome@c3df82b`.
- [x] **The light:** green means `welcome` arrived and the `Notifications` subscription was confirmed. Amber means connected but the subscription isn't confirmed yet or was rejected.
- [x] Notification routing (`src/realtime.js`) doesn't change. The payload is the same `Notifications` message.
- [x] Unit tests for the cable client: frames, identifiers, reject, disconnect.
- [x] Replace REALTIME_CONTRACT.md with a short "cable contract" doc.

### 3. Tests
- [x] **Offline (every PR):** rewrite `tests/e2e/helpers/fake-node.ts` to speak ActionCable. It serves `/auth/user_login`, accepts `/cable` with the subprotocol and `?token=`, sends `welcome`, and confirms `Notifications`. Specs: login, subscription, a `tab:new` that opens a tab, a ringing call shown in the popup.
- [ ] **Real user, through NATS (local, then CI):**
  - Bring up the stack from `voipappz-api/docker-compose.yml` (NATS, Postgres, Redis and the API) plus a va-crystal node, both on the same NATS.
  - Create a real user (`make tenant` / `make onboard` in mothership).
  - The extension logs in with that user at the API, opens cable, and subscribes.
  - The test **publishes a screen pop to NATS**, which reaches the node's `Cable::NATSBackend`, then the extension, and the tab opens.
  - To verify first: the exact NATS subject the node's cable backend relays to the `notifications:<user_uuid>` stream (see `va-crystal/node/spec/realtime/cable_nats_pubsub_spec.cr`).
- [x] Removed the portal-only specs (`portal-login`, `portal-receive`).

### 4. CI
- [x] Job `test`: mise, `npm ci`, lint, unit tests, build, then the offline e2e in Chrome `--headless=new`. `dist/` is uploaded as an artifact (not published).
- [ ] Job `real-user`: the compose stack and the real-user/NATS spec.
  - Open question: where the API and node images come from in CI (ghcr images, or built in the job), and which secrets, if any, it needs.

### 5. Clean up
- [x] Removed the leftover worktrees and unpushed branches in `voipappz/app` and `voipappz/builder`. Neither repo keeps extension code.
- [ ] `voipappz/chrome`: commit or stash its uncommitted work, then archive the repo once step 4 is green.

## Follow-ups (each its own PR, after the above)

- [x] **Restart recovery:** done. The worker stores `{user_uuid, token, cable}` in `chrome.storage.local` (`src/sessionStore.js`) and reconnects by itself on start, `runtime.onStartup`, `onInstalled` and a 1-minute `chrome.alarms` wake; logout and a refused token clear it. `minimum_chrome_version: "116"`, `alarms` permission. e2e `mock-restart.spec.ts` really restarts the browser with the popup never opened and requires the tab to open; a logout survives a restart.
- [x] **Connect and welcome deadline:** done. A socket with no `welcome` 10s after opening is closed and retried.
- [x] **Releases:** done. `make release VERSION=x` tags `vx`; `.github/workflows/release.yml` lints, unit-tests, builds with that version, runs the offline e2e and the live cable check on the release build, and publishes a GitHub Release with `voipappz-extension-<version>.zip` (not the Web Store).
- [x] **Live check:** `make live` / CI: `wss://switch.voipappz.io/cable` answers ActionCable (no credential).
- **OTP in login:** `/auth/user_login` can return `{otp_sent, temp_token}` instead of `{user, token}`. Then ask for the code and call `/auth/user/otp/verify` with `temp_token` and `code`, retrying on a wrong or expired code. The Angular build never handled this. Open question: is OTP on for agent users?
- **wss only** outside local tests: refuse a `ws://` cable URL in a packed build, since the token is in its query.
- **Per-customer builds from env:** `API_URL`, `CABLE_URL` and `CUSTOMER` at build time, instead of edits to `config.js`.
- **Manifest:** drop the leftover `<all_urls>` content script and the unused `tabs`/`storage` permissions (changes the install prompt).
- **Availability and break status** are local only, as before. Decide whether they should set the agent's real state.
- **Translations** for the popup's strings.

## Open questions for the owner

1. **The cable URL per customer:** is it always `<api host>/cable`, or a separate node host (for example `wss://node.<customer>/cable`)?
2. **The real-user/NATS test in CI:** run the full stack in GitHub Actions, or only locally (`make test-real`) for now?
