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
 *   GET  /nats  (websocket) -> just enough NATS: INFO, CONNECT, PING/PONG,
 *                              SUB bookkeeping, and MSG frames pushed by the
 *                              test
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
  subs: Map<string, number>; // subject -> sid, as SUBscribed by the worker
  publish(subject: string, payload: unknown): boolean;
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

  const subs = new Map<string, number>();
  const sockets = new Set<any>();
  const wss = new WebSocketServer({ server, path: '/nats' });

  wss.on('connection', (ws: any) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    // Always binary frames: nats.ws parses bytes and a text frame would hand
    // it a string.
    ws.send(Buffer.from(
      'INFO {"server_id":"FAKE","server_name":"FAKE","version":"2.14.6","proto":1,"headers":true,"max_payload":1048576,"client_id":1}\r\n',
    ));
    let acc = '';
    ws.on('message', (data: Buffer) => {
      acc += data.toString('latin1');
      let i: number;
      while ((i = acc.indexOf('\r\n')) !== -1) {
        const line = acc.slice(0, i);
        acc = acc.slice(i + 2);
        if (line === 'PING') { ws.send(Buffer.from('PONG\r\n')); continue; }
        if (line.startsWith('SUB ')) {
          const [, subject, sid] = line.split(' ');
          subs.set(subject, Number(sid));
        }
        // CONNECT / PONG / UNSUB need no reply for a non-verbose client.
      }
    });
  });

  await new Promise<void>((r) => server.listen(0, r)); // all interfaces: Chrome may resolve localhost to ::1
  const port = (server.address() as any).port;

  return {
    origin: `https://localhost:${port}`,
    userUuid,
    subs,
    publish(subject, payload) {
      const sid = subs.get(subject);
      if (sid === undefined) return false;
      const body = JSON.stringify(payload);
      const frame = Buffer.concat([
        Buffer.from(`MSG ${subject} ${sid} ${Buffer.byteLength(body)}\r\n`),
        Buffer.from(body),
        Buffer.from('\r\n'),
      ]);
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
