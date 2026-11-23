// Send one screen pop to an agent through NATS, the way the platform does:
// a {"action":"tab:new","url":...} message on notifications:<user_uuid>. The
// node relays that subject straight into the agent's cable Notifications
// stream (va-crystal va-shared/src/cable_nats_backend.cr), and the extension
// opens the tab.
//
//   NATS_USER=... NATS_PASSWORD=... node scripts/screen-pop.mjs <user_uuid> [url]
//   NATS_TOKEN=...                  node scripts/screen-pop.mjs <user_uuid> [url]
//
// NATS_URL defaults to the build customer's wss://<host>/nats (EXT_CUSTOMER). An agent's own login
// token is NOT a NATS credential (the server answers Authorization Violation):
// this needs a NATS user allowed to publish on notifications:*. Plain NATS
// protocol over a WebSocket, so no NATS library is needed.
import WebSocket from 'ws';
import { CONFIG } from '../src/config.js';

const [uuid, url = 'https://example.com/?screen-pop-test'] = process.argv.slice(2);
if (!uuid) { console.error('usage: node scripts/screen-pop.mjs <user_uuid> [url]'); process.exit(2); }
const server = process.env.NATS_URL || `wss://${new URL(CONFIG.API_ENDPOINT).host}/nats`;
const auth = process.env.NATS_TOKEN ? { auth_token: process.env.NATS_TOKEN }
  : process.env.NATS_USER ? { user: process.env.NATS_USER, pass: process.env.NATS_PASSWORD || '' } : {};
const subject = `notifications:${uuid}`;
const body = JSON.stringify({ action: 'tab:new', url });

const fail = (why) => { console.error(`✗ ${why}`); process.exit(1); };
setTimeout(() => fail(`no answer from ${server} within 15s`), 15000);
const ws = new WebSocket(server);
ws.on('error', (e) => fail(e.message));
let sent = false;
ws.on('message', (d) => {
  const s = String(d);
  if (s.startsWith('INFO') && !sent) {
    sent = true;
    // PUB, then PING: the PONG comes back only after the server processed the
    // PUB, and a permission error arrives before it.
    ws.send(`CONNECT ${JSON.stringify({ verbose: false, pedantic: false, protocol: 1, headers: true, name: 'screen-pop', ...auth })}\r\n`
      + `PUB ${subject} ${Buffer.byteLength(body)}\r\n${body}\r\nPING\r\n`);
  } else if (s.startsWith('-ERR')) {
    fail(`${server}: ${s.trim()}`);
  } else if (s.includes('PONG')) {
    console.log(`✔ published ${body} on ${subject} via ${server}`);
    ws.close(); process.exit(0);
  }
});
