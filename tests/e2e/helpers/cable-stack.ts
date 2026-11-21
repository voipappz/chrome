/**
 * The cable-events stack, from the extension suite's side.
 *
 * A copy of the few things `tests/cable-events/helpers.ts` provides — token,
 * NATS publisher, event shape — rather than an import: that file lives in
 * another repo. Keep the two in step by hand; they are small on purpose.
 */
import { createHmac, randomUUID } from 'crypto';
import * as net from 'net';
import * as path from 'path';

export const PORTS = {
  portal: Number(process.env.CABLE_EVENTS_PORTAL_PORT || 14001),
  nats: Number(process.env.CABLE_EVENTS_NATS_PORT || 14222),
  esl: Number(process.env.CABLE_EVENTS_ESL_CONTROL_PORT || 18022),
};
export const PORTAL = `http://127.0.0.1:${PORTS.portal}`;
export const SECRET = process.env.CABLE_EVENTS_SECRET || 'cable-events-test-secret';
// The stack lives in the repo that owns tests/cable-events; point at it with
// CABLE_EVENTS_COMPOSE when it is not checked out beside this one.
export const COMPOSE = ['-f', process.env.CABLE_EVENTS_COMPOSE
  || path.resolve(import.meta.dirname, '../../../../tests/cable-events/docker-compose.yml')];

export const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');
export const uuid = () => randomUUID();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Identity { user: string; env: string; account: string }
export const identity = (): Identity => ({ user: uuid(), env: uuid(), account: uuid() });

/** A user token the node's `verify` accepts. */
export function mint(id: Identity, secret = SECRET): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ user_uuid: id.user, account_uuid: id.account, environment_uuids: [id.env] }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** PUB one JSON payload and resolve once the broker PONGs. */
export function publish(subject: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const sock = net.connect({ host: '127.0.0.1', port: PORTS.nats });
    let buf = '', sent = false;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`nats: no PONG within 5s for ${subject}`)); }, 5000);
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      if (!sent && buf.startsWith('INFO')) {
        sent = true;
        sock.write(`CONNECT {"verbose":false,"pedantic":false,"name":"portal-receive-spec"}\r\n` +
                   `PUB ${subject} ${Buffer.byteLength(body)}\r\n${body}\r\nPING\r\n`);
      }
      const err = buf.match(/-ERR[^\r\n]*/);
      if (err) { clearTimeout(timer); sock.destroy(); reject(new Error(`nats: ${err[0]}`)); return; }
      if (sent && buf.includes('PONG')) { clearTimeout(timer); sock.end(); resolve(); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** The normalized call event va-crystal publishes on `call_events`. */
export function callEvent(id: Identity, over: Record<string, unknown> = {}) {
  const call = uuid();
  return {
    type: 'call', action: 'user.answer', id: call, call_uuid: call,
    user_uuid: id.user, environment_uuid: id.env,
    caller_id_number: '0500000000', occurred_at: new Date().toISOString(),
    ...over,
  };
}

/** Push one FreeSWITCH event into the node through the stack's faked switch. */
export async function emitEsl(event: Record<string, string>): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${PORTS.esl}/emit`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`fake FreeSWITCH: emit answered ${res.status} ${await res.text()}`);
}

/** A mod_callcenter event as the node's SessionEvent reads it (mirrors va-crystal's cc_event). */
export function callcenterEsl(action: string, id: Identity, callUuid = uuid()) {
  return {
    'Event-Name': 'CUSTOM', 'Event-Subclass': 'callcenter::info',
    'CC-Action': action, 'CC-Agent': id.user, 'CC-Queue': 'support', 'variable_cc_queue': 'support',
    'CC-Member-CID-Number': '0501234567', 'variable_va_call_uuid': callUuid,
    'variable_va_environment_uuid': id.env, 'CC-Member-Session-UUID': `sess-${callUuid}`,
    'Core-UUID': 'core-cable-events', 'Unique-ID': `uid-${callUuid}`,
  };
}
