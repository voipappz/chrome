import { test, expect, chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import {
  PORTAL, COMPOSE, identity, mint, publish, callEvent, uuid, sleep, type Identity,
  emitEsl, callcenterEsl,
} from './helpers/cable-stack';
import { callFrameFor } from './helpers/worker';

/**
 * Chrome → Elixir, with the REAL extension and the REAL portal — the half of
 * the chain the extension can break on its own: the bearer subprotocol, the
 * worker's reconnect, the CORS answer for a chrome-extension:// origin, and
 * what it does with a frame. The other half (node, broker) is the same
 * tests/cable-events stack, so a tab opening here means the WHOLE chain ran:
 *
 *   NATS call_events → va-crystal → Elixir ScreenPop → /ws/events → this worker → a tab
 *
 * No mothership in that stack, so there is no login: the session is SEEDED
 * the way the popup hands it to the worker after a login — a runtime port
 * message `{event:"login", data:{user_uuid, token}, domain}` from an extension
 * page (backgroundPage.ts `onConnect`/`login`). The token is minted with the
 * stack's secret and verified by the node exactly as a mothership-issued one.
 *
 * Gated on CABLE_EVENTS=1 (needs the stack) — `make test-cable`, or the
 * cable-events CI job. Serial: one browser, one worker, one stack.
 */
test.describe.configure({ mode: 'serial' });
test.skip(process.env.CABLE_EVENTS !== '1', 'needs the cable-events stack — run through make test-cable');

const EXT = path.resolve(import.meta.dirname, '../../dist');
const compose = (...args: string[]) =>
  execFileSync('docker', ['compose', ...COMPOSE, ...args], { stdio: 'pipe' }).toString();

let ctx: BrowserContext;
let sw: Worker;
let popup: Page;
let extensionId: string;
let dir: string;
let me: Identity;

/** The worker's socket state, read where it lives. */
const socketState = () => sw.evaluate(() => {
  const s = (self as any)._realtime;
  return { url: (self as any)._realtime_url as string | undefined, readyState: s ? s.readyState : -1 };
});

/** Poll until the worker's socket is OPEN (readyState 1). */
async function waitSocketOpen(ms: number) {
  const deadline = Date.now() + ms;
  let last = await socketState();
  while (Date.now() < deadline) {
    if (last.readyState === 1) return last;
    await sleep(300);
    last = await socketState();
  }
  throw new Error(`worker socket never opened within ${ms}ms — last state ${JSON.stringify(last)}`);
}

/** Record every frame the worker receives from now on, in the worker itself. */
const recordFrames = () => sw.evaluate(() => {
  const s = (self as any)._realtime as WebSocket;
  (self as any)._pw_frames = [];
  s.addEventListener('message', (ev: MessageEvent) => { try { (self as any)._pw_frames.push(JSON.parse(String(ev.data))); } catch { /* not json */ } });
});
const recordedFrames = () => sw.evaluate(() => ((self as any)._pw_frames || []) as any[]);

/** Hand the worker a session, as the popup does after login. */
const seedSession = (id: Identity) => popup.evaluate(({ user, token, domain }) => {
  localStorage.setItem('_domain', domain);
  localStorage.setItem('_token', token);
  localStorage.setItem('_id', user);
  const port = chrome.runtime.connect({ name: 'e2e' });
  port.postMessage({ event: 'login', data: { user_uuid: user, token }, domain });
}, { user: id.user, token: mint(id), domain: PORTAL });

test.beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-portal-'));
  ctx = await chromium.launchPersistentContext(dir, {
    headless: false,
    args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
  extensionId = sw.url().split('/')[2];
  popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html#/main`);
  await popup.waitForURL(/login/);
  me = identity();
  await seedSession(me);
});

test.afterAll(async () => {
  await ctx?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('B1 the worker connects to the portal with the bearer subprotocol and is welcomed', async () => {
  const state = await waitSocketOpen(20_000);
  expect(state.url).toBe(PORTAL.replace(/^http/, 'ws') + '/ws/events');
  // A refused upgrade closes at once; staying open is the welcome.
  await sleep(2000);
  expect((await socketState()).readyState, 'socket closed after opening — refused or dropped').toBe(1);
});

test('B2 a call event for this user opens a tab: the whole chain', async () => {
  await recordFrames();
  const opened = ctx.waitForEvent('page', { timeout: 30_000 });
  // Publish-until-received: the worker's per-user streams confirm a moment
  // after the socket opens, and cable does not replay.
  const deadline = Date.now() + 30_000;
  let frame: any;
  while (Date.now() < deadline && !frame) {
    await publish('call_events', callEvent(me));
    await sleep(500);
    frame = (await recordedFrames()).find((f) => f.type === 'notification' && f.message?.action === 'tab:new');
  }
  expect(frame, 'the worker never received the tab:new frame').toBeTruthy();
  expect(Object.keys(frame.message).sort()).toEqual(['action', 'url']);
  const tab = await opened;
  // The URL is committed at navigation start; loading it is not the point.
  await expect.poll(() => tab.url(), { timeout: 10_000 }).toContain(new URL(frame.message.url).host);
  await tab.close();
});

test('B3 the portal restarts: the worker reconnects on its own and receives again', async () => {
  test.setTimeout(180_000);
  compose('restart', 'portal');
  // The worker's own backoff is 3s (scheduleReconnect); the portal takes a
  // few seconds to boot and confirm its relay. Nothing is re-seeded here —
  // the reconnect must come from the session the worker already holds.
  await expect.poll(async () => (await socketState()).readyState, { timeout: 90_000, intervals: [1000] }).toBe(1);
  await recordFrames();
  const opened = ctx.waitForEvent('page', { timeout: 60_000 });
  const deadline = Date.now() + 60_000;
  let frame: any;
  while (Date.now() < deadline && !frame) {
    await publish('call_events', callEvent(me));
    await sleep(500);
    frame = (await recordedFrames()).find((f) => f.type === 'notification' && f.message?.action === 'tab:new');
  }
  expect(frame, 'no tab:new after the portal restart').toBeTruthy();
  const tab = await opened;
  await tab.close();
});

test('B4 a preflight from the extension\'s own origin is answered by the portal', async ({ request }) => {
  // chrome-extension://<id> is an origin no upstream allowlist can name; the
  // portal answers for itself (Plugs.EngineProxy) or the login never leaves
  // the browser. The live counterpart of engine_proxy_test.exs.
  const res = await request.fetch(`${PORTAL}/auth/user_login`, {
    method: 'OPTIONS',
    headers: { Origin: `chrome-extension://${extensionId}`, 'Access-Control-Request-Method': 'POST' },
  });
  expect(res.status(), await res.text()).toBe(204);
  expect(res.headers()['access-control-allow-origin']).toBe('*');
  expect(res.headers()['access-control-allow-methods'] || '').toContain('POST');
});

test('B5 no bearer, no socket', async ({ request }) => {
  const res = await request.get(`${PORTAL}/ws/events`, {
    headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'AQIDBAUGBwgJCgsMDQ4PEA==' },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
});

test('B6 a call-state notification reaches the popup as call:ringing', async () => {
  const callUuid = uuid();
  await publish(`notifications:${me.user}`, { type: 'agent', message: { type: 'ringing', call: { uuid: callUuid }, screen: { uuid: 'scr-1' } } });
  const frame = await callFrameFor(popup, callUuid);
  expect(frame, 'the worker pushed no call frame down the port').toBeTruthy();
  expect(frame.status).toBe('call:ringing');
  expect(frame.call.uuid).toBe(callUuid);
});

test('B7 from the switch: FreeSWITCH reports this agent answering, and a tab opens', async () => {
  // The event enters at the very front — mod_callcenter's bridge-agent-start
  // over ESL into the node — and nothing between there and the tab is faked.
  await recordFrames();
  const opened = ctx.waitForEvent('page', { timeout: 30_000 });
  const callUuid = uuid();
  const deadline = Date.now() + 30_000;
  let frame: any;
  while (Date.now() < deadline && !frame) {
    await emitEsl(callcenterEsl('bridge-agent-start', me, callUuid));
    await sleep(700);
    frame = (await recordedFrames()).find((f) => f.type === 'notification' && f.message?.action === 'tab:new');
  }
  expect(frame, 'the worker never received the tab:new for the ESL answer').toBeTruthy();
  const tab = await opened;
  await expect.poll(() => tab.url(), { timeout: 10_000 }).toContain(new URL(frame.message.url).host);
  await tab.close();
});
