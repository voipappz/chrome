# VoIPAppz Chrome Extension

A Chrome extension for VoIPAppz agents. It signs in against a VoIPAppz node and
opens a live connection for realtime events — screen pops, call state and agent
availability — so an incoming call can pop the caller's CRM record automatically.

## Install

1. Download `extension-build.zip` from the [latest release](https://github.com/voipappz/chrome/releases/latest).
2. Unzip it into a folder you'll keep — Chrome loads the extension *from* this
   folder, so deleting it uninstalls the extension.
3. Open `chrome://extensions`.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and select the unzipped folder.
6. Pin the extension so its icon stays visible: click the puzzle-piece icon in
   the toolbar, then the pin next to **Nimbus**.

## Logging in

Click the extension icon. The popup asks for three things:

| Field | What to enter |
|---|---|
| **Domain** | Your VoIPAppz node's address, e.g. `https://pbx.example.com`. `https://` is added if you leave the scheme off. |
| **Username** | Your **user** email address. |
| **Password** | That user's password. |

Two things people get wrong here:

- **This is a user login, not your portal account login.** The extension posts
  to `/auth/user_login`, which reads the *users* table. Your portal sign-in is a
  separate credential in a separate table, and it will be rejected here. If you
  administer the node, `make onboard` prints the right one on the line labelled
  **Extension login**.
- **Plus-addressing does not work.** The server rejects `+` in the local part of
  the address before it ever checks the password, and the error you get back is
  the generic "Invalid email or password".

After a successful sign-in the popup shows your name, an availability selector
and the current call card. The session persists — reopening the popup does not
ask you to sign in again. **Logout** (top right) clears it.

If the tenant has OTP enabled for user logins, sign-in will fail: the extension
has no OTP step.

## What you get once connected

- **Screen pop** — an inbound call opens the caller's CRM record in a new tab
- **Call state** — ringing / answered / hung up, reflected in the popup
- **Agent state** — availability and status, live

## Node requirements

Sign-in works against any node serving `/auth/user_login`. The **realtime feed**
needs two more things, or you will sign in successfully and never receive an
event:

1. a NATS `websocket` listener on the node, and a `/nats` route at the edge
   proxying to it
2. a NATS user matching the credential in `chrome/src/backgroundPage.ts`

(1) ships in the mothership stack. (2) is **not configured yet** — the extension
presents a shared credential, which would need a wildcard `notifications.>`
subscribe permission to work, and that is a cross-tenant read. Per-user scoping
(NATS `auth_callout`, where the extension presents its login JWT instead) is the
intended fix. Until then the realtime half is inert.

## Development

```bash
npm ci --legacy-peer-deps
npm run watch                     # rebuild on change into angular/dist
```

Load `angular/dist` as the unpacked extension. Changes to the **background** and
**content** scripts need a reload in `chrome://extensions`; popup changes do not.

```bash
npm run build:production          # produces extension-build.zip
npm run test:e2e                  # Playwright, needs TEST_DOMAIN/USERNAME/PASSWORD
```

On Node 17+ the production build needs `NODE_OPTIONS=--openssl-legacy-provider`
(webpack 4 uses a hash OpenSSL 3 no longer offers). Only the `build:chrome*`
scripts set it, so export it for the full `build:production` run.

## Layout

- `angular/` — the popup UI (Angular; each feature is a lazily-loaded module under `angular/src/app/modules`)
- `chrome/src/` — the background service worker and content script
