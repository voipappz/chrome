// Is the cable this build connects to really there, and really ActionCable?
//
//   node scripts/check-live-cable.mjs            # the build's CONFIG.CABLE_URL
//   node scripts/check-live-cable.mjs wss://host/cable
//
// Opens the socket with no token, as nobody: a real cable server accepts the
// actioncable-v1-json subprotocol and then answers in ActionCable -- here
// {"type":"disconnect","reason":"unauthorized"}, because there is no token.
// That proves the address resolves, TLS is valid, a cable server answers there,
// and it speaks the protocol the worker speaks. It needs no
// credential and changes nothing on the server. Exit 0 on an ActionCable
// answer, 1 otherwise.
import WebSocket from 'ws';
import { CONFIG } from '../src/config.js';

const url = process.argv[2] || CONFIG.CABLE_URL;
const fail = (why) => { console.error(`✗ ${url}: ${why}`); process.exit(1); };
const timer = setTimeout(() => fail('no ActionCable answer within 15s'), 15000);

const ws = new WebSocket(url, ['actioncable-v1-json']);
ws.on('unexpected-response', (_req, res) => fail(`HTTP ${res.statusCode} instead of a WebSocket upgrade`));
ws.on('error', (err) => fail(err.message));
ws.on('open', () => {
  if (ws.protocol !== 'actioncable-v1-json') fail(`the server did not accept actioncable-v1-json (got "${ws.protocol}")`);
});
ws.on('message', (data) => {
  let frame;
  try { frame = JSON.parse(String(data)); } catch { fail(`not JSON: ${String(data).slice(0, 80)}`); }
  if (frame?.type === 'welcome' || (frame?.type === 'disconnect' && frame.reason === 'unauthorized')) {
    clearTimeout(timer);
    console.log(`✔ ${url} answers ActionCable (${frame.type}${frame.reason ? ': ' + frame.reason : ''})`);
    ws.close();
    process.exit(0);
  }
  fail(`unexpected first frame: ${String(data).slice(0, 120)}`);
});
