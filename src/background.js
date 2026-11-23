import { CONFIG } from './config.js';
import { CABLE_PROTOCOL, STALE_AFTER_MS, cableUrl, classify, identifiers, redact, subscribeCommand, withToken } from './cable.js';
import { callFrame, routeNotification } from './realtime.js';
import { clearSession, loadSession, saveSession } from './sessionStore.js';

// The service worker: holds the cable socket, opens screen-pop tabs, and tells
// the popup what it knows. The behaviour is the Angular build's
// (voipappz/chrome, chrome/src/backgroundPage.ts); only the transport is cable
// instead of the portal's /ws/events. Protocol notes: CABLE_CONTRACT.md.

let ws = null;
let currentUuid = '';
let currentToken = '';
let currentUrl = '';
let ids = null;
let reconnectTimer = null;
let staleTimer = null;
let refused = false; // the server said reconnect:false (token refused): stop retrying
let welcomeTimer = null;

// A socket that has not been welcomed this long after it was opened is closed
// and retried: a handshake stuck on a proxy, or a server that accepts and says
// nothing, would otherwise hold the worker on a dead socket forever.
const WELCOME_DEADLINE_MS = 10000;
// Wakes the worker if Chrome stopped it with nothing else to wake it.
const KEEPALIVE_ALARM = 'cable-keepalive';
const store = chrome.storage?.local;

// ── the realtime light ───────────────────────────────────────────────────────
//
// NOTHING IS STORED. The worker holds the state in memory and pushes it down
// the port the popup opens; a popup that opens later asks with
// {event:"status"} and gets an answer by return. MV3 stops the worker and the
// socket dies with it, so a stored "connected" would be wrong once written.
//
// GREEN IS NOT "the socket opened". It is `welcome` AND the Notifications
// subscription confirmed: that is the moment a screen pop can arrive. Amber is
// connected but not (yet) subscribed, or the subscription was rejected.
let realtimeState = { connected: false, cable_ready: false };

// Every popup that has connected. A Set because the same page reconnects on
// every open, and a closed popup's port must not be written to.
const ports = new Set();

// A popup opens long after the call it needs to draw arrived, so the last one
// is replayed to it. In memory only: it is worth exactly as long as the worker.
let lastCall = null;

function setRealtimeState({ connected, cable_ready }) {
  realtimeState = { connected, cable_ready: connected ? !!cable_ready : false };
  ports.forEach((p) => sendState(p));
  paintBadge();
}

function sendState(port) {
  post(port, { event: 'realtime', ...realtimeState });
  if (lastCall) post(port, callFrame(lastCall));
}

function post(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    ports.delete(port);
  }
}

const broadcast = (msg) => ports.forEach((p) => post(p, msg));

function paintBadge() {
  const action = chrome.action;
  if (!action) return;
  const green = realtimeState.connected && realtimeState.cable_ready;
  const amber = realtimeState.connected && !realtimeState.cable_ready;
  try {
    action.setBadgeBackgroundColor({ color: green ? '#2e7d32' : amber ? '#ed6c02' : '#9e9e9e' });
    // No badge when signed out: a grey pill there would read as a fault rather
    // than as "nobody is logged in".
    action.setBadgeText({ text: currentUuid ? ' ' : '' });
    action.setTitle({
      title: !currentUuid
        ? CONFIG.PAGE_TITLE
        : green ? `${CONFIG.PAGE_TITLE} — connected`
          : amber ? `${CONFIG.PAGE_TITLE} — connected, not subscribed`
            : `${CONFIG.PAGE_TITLE} — disconnected`,
    });
  } catch { /* action API unavailable in tests */ }
}

chrome.runtime.onConnect.addListener(onConnect);
chrome.action?.setTitle({ title: CONFIG.PAGE_TITLE });
// A restarted worker has no socket yet, whatever the last run did.
setRealtimeState({ connected: false });

// RESTART RECOVERY. The worker reconnects from its own stored session
// (sessionStore.js) whenever it starts -- browser start, extension update or
// reload, a worker Chrome stopped and woke again -- and on a one-minute alarm,
// so screen pops resume without anyone opening the popup.
chrome.runtime.onStartup?.addListener(restore);
chrome.runtime.onInstalled?.addListener(restore);
chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === KEEPALIVE_ALARM) restore(); });
restore();

async function restore() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (currentUuid) { openSocket(); return; }
  let s = null;
  try { s = await loadSession(store); } catch (err) { console.error('reading the stored session', err); }
  if (s && !currentUuid) login({ data: { user_uuid: s.user_uuid, token: s.token }, cable: s.cable });
}

function onConnect(port) {
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  // The popup renders before it asks, so answer immediately as well.
  sendState(port);

  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.event === 'status') sendState(port);
    else if (msg.event === 'logout') logout();
    else if (msg.event === 'login' && msg.data?.user_uuid) login(msg);
  });
}

function login(msg) {
  const uuid = msg.data.user_uuid;
  const token = msg.data.token || '';
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
      && currentUuid === uuid && currentToken === token) return;
  disconnect();

  currentUrl = msg.cable || cableUrl(msg.domain || CONFIG.API_ENDPOINT, CONFIG.CABLE_URL);
  currentUuid = uuid;
  currentToken = token;
  ids = identifiers(uuid);
  refused = false;
  // Exposed on self so Playwright can check the target before a connection is
  // even attempted. Without the token.
  self._cable_url = currentUrl;
  saveSession(store, { user_uuid: uuid, token, cable: currentUrl }).catch((err) => console.error('storing the session', err));
  chrome.alarms?.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  openSocket();
}

// The agent signed out: forget the stored session too, or the next restart
// would sign them back in.
function logout() {
  disconnect();
  clearSession(store).catch(() => {});
  chrome.alarms?.clear(KEEPALIVE_ALARM);
}

function openSocket() {
  if (!currentUuid || !currentUrl || refused) return;

  let sock;
  try {
    sock = new WebSocket(withToken(currentUrl, currentToken), [CABLE_PROTOCOL]);
  } catch (err) {
    console.error('cable connect failed', redact(currentUrl), err);
    setRealtimeState({ connected: false });
    scheduleReconnect();
    return;
  }
  ws = sock;
  self._cable = sock;
  clearTimeout(welcomeTimer);
  welcomeTimer = setTimeout(() => {
    if (ws === sock) { console.warn('cable: no welcome in', WELCOME_DEADLINE_MS, 'ms, retrying'); try { sock.close(); } catch { /* gone */ } }
  }, WELCOME_DEADLINE_MS);

  sock.onmessage = (ev) => {
    if (ws !== sock) return;
    const f = classify(ev.data, ids);
    switch (f.kind) {
      case 'welcome':
        clearTimeout(welcomeTimer);
        armStale(sock);
        setRealtimeState({ connected: true, cable_ready: false });
        // Nothing may be sent before welcome; after it, subscribe. A message
        // published before the subscription is confirmed is simply not
        // delivered, which is why a test waits for the light to turn green.
        sock.send(subscribeCommand(ids.notifications));
        sock.send(subscribeCommand(ids.state));
        break;
      case 'ping':
        armStale(sock);
        break;
      case 'confirm':
        if (f.identifier === ids.notifications) setRealtimeState({ connected: true, cable_ready: true });
        break;
      case 'reject':
        console.error('cable rejected subscription', f.identifier);
        if (f.identifier === ids.notifications) setRealtimeState({ connected: true, cable_ready: false });
        break;
      case 'disconnect':
        console.warn('cable disconnected by server:', f.reason);
        // reconnect:false is the server refusing this token (expired, or from
        // another deployment). Retrying would only be refused again.
        if (!f.reconnect) {
          refused = true;
          clearSession(store).catch(() => {});
          chrome.alarms?.clear(KEEPALIVE_ALARM);
        }
        break;
      case 'notification':
        handleNotification(f.message);
        break;
      case 'state':
        // Live agent state from the node.
        broadcast({ event: 'state', op: f.message });
        break;
      default:
        break;
    }
  };

  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    self._cable = null;
    clearTimeout(staleTimer);
    clearTimeout(welcomeTimer);
    setRealtimeState({ connected: false });
    scheduleReconnect();
  };
  sock.onerror = () => console.error('cable socket error', redact(currentUrl));
}

// A socket that stops hearing pings is dead even if nobody told it (a laptop
// that slept, a proxy that dropped it). Close it so onclose reconnects.
function armStale(sock) {
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => { if (ws === sock) { try { sock.close(); } catch { /* gone */ } } }, STALE_AFTER_MS);
}

// MV3 kills an idle service worker in ~30s. Incoming socket traffic resets that
// timer (Chrome 116+), and cable pings every 3s, so the connection is what
// keeps the worker alive.
function scheduleReconnect() {
  if (!currentUuid || reconnectTimer || refused) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; openSocket(); }, 3000);
}

function disconnect() {
  lastCall = null;
  currentUuid = '';
  currentToken = '';
  ids = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  clearTimeout(staleTimer);
  clearTimeout(welcomeTimer);
  const sock = ws;
  ws = null;
  self._cable = null;
  if (sock) { try { sock.close(); } catch { /* already closed */ } }
  setRealtimeState({ connected: false });
}

function handleNotification(data) {
  const route = routeNotification(data);
  if (route.kind === 'tab') openTab(route.url);
  else if (route.kind === 'call') { lastCall = { event: route.event, call: route.call }; broadcast(callFrame(lastCall)); }
  else if (route.kind === 'other') broadcast({ event: 'notification', data });
}

// The screen pop: a new tab every time, as the Angular worker did.
function openTab(url) {
  chrome.tabs.create({ url });
}
