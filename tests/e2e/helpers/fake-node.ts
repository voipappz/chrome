import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { WebSocketServer } from 'ws';

/**
 * A MIMICKED VoIPAppz node: one HTTPS server that plays both halves the
 * extension talks to —
 *
 *   POST /auth/user_login   -> a canned {token, user:{uuid}} session (the API)
 *   GET  /cable (websocket) -> the node's ActionCable: welcome, confirms the
 *                              subscriptions, then Notifications messages
 *                              pushed by the test
 *
 * Exists so the receive path — subject naming, payload decoding, the
 * popup-port contract, openTab — runs on a hosted CI runner with no real
 * node, no database, no broker and no credential. It deliberately does NOT
 * prove the server side publishes correctly; spec/integration/
 * screen_pop_nats_spec.rb in voipappz-api owns that half, on a real broker.
 */
export interface FakeNode {
  origin: string;
  userUuid: string;
  // what the client offered and sent, so a test can assert the handshake
  offeredProtocols: string[];
  tokens: string[];
  subscriptions: string[];
  // pushes `message` on every Notifications subscription, under the identifier
  // the client subscribed with (the server echoes it verbatim)
  publish(message: Record<string, unknown>): boolean;
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
        // As strict as the real API (voipappz-api lib/endpoints/auth.rb): it
        // reads params, i.e. a form body or the query string, and answers a
        // JSON body 406 "Empty email field". The query string is refused here
        // too: it would put the password in every access log.
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const form = String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')
            ? new URLSearchParams(raw) : new URLSearchParams();
          if (req.url !== '/auth/user_login' || !form.get('email') || !form.get('password')) {
            res.writeHead(406, { 'Content-Type': 'application/json', ...cors });
            res.end(JSON.stringify({ id: 'not_acceptable', message: 'Empty email field' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({ token: 'ci-fake-token', user: { uuid: userUuid, name: 'CI Agent', email: form.get('email') } }));
        });
        return;
      }
      // Anything else doubles as the screen-pop target, so an opened tab has
      // something real to load.
      res.writeHead(200, { 'Content-Type': 'text/html', ...cors });
      res.end('<title>popped</title>ok');
    },
  );

  const offeredProtocols: string[] = [];
  const tokens: string[] = [];
  const subscriptions: string[] = [];
  const sockets = new Set<any>();
  const wss = new WebSocketServer({
    server,
    path: '/cable',
    // The node speaks only actioncable-v1-json, and so does this.
    handleProtocols: (protocols: Set<string>) => (protocols.has('actioncable-v1-json') ? 'actioncable-v1-json' : false),
  });

  wss.on('connection', (ws: any, req: any) => {
    const offered = String(req.headers['sec-websocket-protocol'] || '')
      .split(',').map((v: string) => v.trim()).filter(Boolean);
    offeredProtocols.push(...offered);
    const token = new URL(req.url, 'https://x').searchParams.get('token') || '';
    tokens.push(token);
    // As the node does: no subprotocol or no token, and the socket is refused.
    if (!offered.includes('actioncable-v1-json') || !token) {
      ws.send(JSON.stringify({ type: 'disconnect', reason: 'unauthorized', reconnect: false }));
      ws.close();
      return;
    }

    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (raw: Buffer) => {
      let cmd: any;
      try { cmd = JSON.parse(raw.toString()); } catch { return; }
      if (cmd?.command !== 'subscribe') return;
      subscriptions.push(cmd.identifier);
      ws.send(JSON.stringify({ type: 'confirm_subscription', identifier: cmd.identifier }));
    });
    ws.send(JSON.stringify({ type: 'welcome' }));
  });

  await new Promise<void>((r) => server.listen(0, r)); // all interfaces: Chrome may resolve localhost to ::1
  const port = (server.address() as any).port;

  return {
    origin: `https://localhost:${port}`,
    userUuid,
    offeredProtocols,
    tokens,
    subscriptions,
    publish(message) {
      if (!sockets.size) return false;
      const ids = subscriptions.filter((i) => { try { return JSON.parse(i).channel === 'Notifications'; } catch { return false; } });
      for (const ws of sockets) for (const identifier of new Set(ids)) ws.send(JSON.stringify({ identifier, message }));
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
