import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
// Playwright transpiles with esbuild and does not typecheck, so the untyped
// require is fine — and `ws` is what the repo already uses elsewhere.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WebSocketServer } = require('ws');

/**
 * A MIMICKED VoIPAppz node: one HTTPS server that plays both halves the
 * extension talks to —
 *
 *   POST /auth/user_login   -> a canned {token, user:{uuid}} session
 *   GET  /cable (websocket) -> just enough ActionCable: welcome,
 *                              confirm_subscription, and data frames pushed
 *                              by the test
 *
 * Exists so the receive path — subject naming, payload decoding, the
 * chrome.storage contract, openTab — runs on a hosted CI runner with no real
 * node, no database, no broker and no credential. It deliberately does NOT
 * prove the server side publishes correctly; spec/integration/
 * screen_pop_nats_spec.rb in voipappz-api owns that half, on a real broker.
 */
export interface FakeNode {
  origin: string;
  userUuid: string;
  // identifier JSON (exactly as the client sent it) -> confirmed
  subs: Map<string, boolean>;
  publish(identifier: string, message: unknown): boolean;
  close(): Promise<void>;
}

export async function startFakeNode(): Promise<FakeNode> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-node-'));
  // Self-signed, throwaway. Chrome is launched with
  // --ignore-certificate-errors, so the CN never matters.
  execSync(
    'openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 -subj /CN=localhost',
    { cwd: dir, stdio: 'pipe' },
  );

  const userUuid = '00000000-cafe-4000-8000-0000000000c1';

  const server = https.createServer(
    { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) },
    (req, res) => {
      // The manifest grants no host_permissions, so the popup's fetch is
      // subject to CORS — the real edge runs Kong's cors plugin; mirror it.
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      if (req.method === 'POST' && req.url?.startsWith('/auth/user_login')) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify({ token: 'ci-fake-token', user: { uuid: userUuid, name: 'CI Agent', email: 'ci@fake.local' } }));
        return;
      }
      // Anything else doubles as the screen-pop target, so an opened tab has
      // something real to load.
      res.writeHead(200, { 'Content-Type': 'text/html', ...cors });
      res.end('<title>popped</title>ok');
    },
  );

  const subs = new Map<string, boolean>();
  const sockets = new Set<any>();
  const wss = new WebSocketServer({ server, path: '/cable' });

  wss.on('connection', (ws: any, req: any) => {
    // The subprotocol is required by the real server, so require it here too —
    // otherwise a client that forgot it would pass the fake and fail in prod.
    const proto = String(req.headers['sec-websocket-protocol'] || '');
    if (!proto.includes('actioncable-v1-json')) { ws.close(); return; }

    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.send(JSON.stringify({ type: 'welcome' }));

    ws.on('message', (data: Buffer) => {
      let frame: any;
      try { frame = JSON.parse(data.toString()); } catch { return; }
      if (frame?.command === 'subscribe' && typeof frame.identifier === 'string') {
        subs.set(frame.identifier, true);
        // Echoed back VERBATIM: an ActionCable subscription is keyed by the
        // exact identifier string, so a client matching on it must get the
        // same bytes it sent.
        ws.send(JSON.stringify({ type: 'confirm_subscription', identifier: frame.identifier }));
      }
    });
  });

  await new Promise<void>((r) => server.listen(0, r)); // all interfaces: Chrome may resolve localhost to ::1
  const port = (server.address() as any).port;

  return {
    origin: `https://localhost:${port}`,
    userUuid,
    subs,
    publish(identifier, message) {
      if (!subs.has(identifier)) return false;
      // A data frame carries identifier + message and NO type — that absence
      // is what tells a client it is data rather than protocol traffic.
      const frame = JSON.stringify({ identifier, message });
      for (const ws of sockets) ws.send(frame);
      return true;
    },
    close: () =>
      new Promise<void>((r) => {
        wss.close();
        for (const ws of sockets) ws.terminate();
        server.close(() => r());
        fs.rmSync(dir, { recursive: true, force: true });
      }),
  };
}
