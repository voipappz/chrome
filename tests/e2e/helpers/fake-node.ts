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
 *   GET  /ws/events (websocket) -> the BFF's browser endpoint: welcome, then
 *                              {type:"notification"|"user.state"} frames
 *                              pushed by the test
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
  // the bearer subprotocol the client offered, so a test can assert the token
  // travelled out of band rather than in the URL
  offeredProtocols: string[];
  publish(frame: Record<string, unknown>): boolean;
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

  const offeredProtocols: string[] = [];
  const sockets = new Set<any>();
  const wss = new WebSocketServer({ server, path: '/ws/events' });

  wss.on('connection', (ws: any, req: any) => {
    // The token rides a subprotocol, never the URL. Reject without one, so a
    // client that regressed to a query parameter fails here rather than in
    // production with the credential in an access log.
    const offered = String(req.headers['sec-websocket-protocol'] || '')
      .split(',').map((v: string) => v.trim()).filter(Boolean);
    offeredProtocols.push(...offered);
    if (!offered.some((v: string) => v.startsWith('voipappz-bearer.'))) { ws.close(); return; }

    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    // Per-user streams are opened server-side from the token's claims, so the
    // client subscribes to nothing — welcome is the whole handshake.
    ws.send(JSON.stringify({ type: 'welcome', ts: new Date().toISOString(), subscribed: [], clients: sockets.size, cable_ready: true }));
  });

  await new Promise<void>((r) => server.listen(0, r)); // all interfaces: Chrome may resolve localhost to ::1
  const port = (server.address() as any).port;

  return {
    origin: `https://localhost:${port}`,
    userUuid,
    offeredProtocols,
    publish(frame) {
      if (!sockets.size) return false;
      const body = JSON.stringify(frame);
      for (const ws of sockets) ws.send(body);
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
