import { CONFIG } from './config.js';
import { bearerProtocol, callFrame, realtimeUrl, routeNotification } from './realtime.js';

// The service worker: holds the realtime socket, opens screen-pop tabs, and
// tells the popup what it knows. Ported line for line from the Angular build's
// chrome/src/backgroundPage.ts; the behaviour is the same.
//
// The realtime server is the portal's /ws/events, a settled decision. The
// server authorizes the socket by the person's own login token and derives
// which streams they get from that token's claims, so which user's events
// arrive is never something the client asks for. That is the reason for going
// through it: talking to cable directly would mean sending our own user_uuid
// and being trusted on it. Contract: extension/REALTIME_CONTRACT.md.

let ws = null;
let currentUuid = '';
let currentToken = '';
let currentUrl = '';
let reconnectTimer = null;

// ── the realtime light ───────────────────────────────────────────────────────
//
// NOTHING IS STORED. The worker holds the state in memory and pushes it down
// the port the popup opens; a popup that opens later asks with
// {event:"status"} and gets an answer by return. MV3 stops the worker and the
// socket dies with it, so a stored "connected" would be wrong the moment it was
// written.
//
// GREEN IS NOT "the socket opened". It is open AND the server said its cable is
// ready: a portal whose cable is down accepts the socket and then delivers
// nothing, and a light that stays green through that is worse than none.
let realtimeState = { connected: false, cable_ready: false };

// Every popup that has connected. A Set because the same page reconnects on
// every open, and a closed popup's port must not be written to.
const ports = new Set();

// A popup opens long after the call it needs to draw arrived, so the last one
// is replayed to it. In memory only: it is worth exactly as long as the worker.
let lastCall = null;

let popTabId = 0;

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
          : amber ? `${CONFIG.PAGE_TITLE} — connected, cable not ready`
            : `${CONFIG.PAGE_TITLE} — disconnected`,
    });
  } catch { /* action API unavailable in tests */ }
}

chrome.runtime.onConnect.addListener(onConnect);
chrome.action?.setTitle({ title: CONFIG.PAGE_TITLE });
// A restarted worker has no socket yet, whatever the last run did.
setRealtimeState({ connected: false });

function onConnect(port) {
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  // The popup renders before it asks, so answer immediately as well.
  sendState(port);

  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.event === 'status') sendState(port);
    else if (msg.event === 'logout') disconnect();
    else if (msg.event === 'login' && msg.data?.user_uuid) login(msg);
  });
}

function login(msg) {
  const uuid = msg.data.user_uuid;
  if (ws && ws.readyState === WebSocket.OPEN && currentUuid === uuid) return;
  disconnect();

  currentUrl = realtimeUrl(msg.domain || CONFIG.API_ENDPOINT);
  currentUuid = uuid;
  currentToken = msg.data.token || '';
  // Exposed on self so Playwright can verify the target before a connection is
  // even attempted.
  self._realtime_url = currentUrl;
  openSocket();
}

function openSocket() {
  if (!currentUuid || !currentUrl) return;

  let sock;
  try {
    sock = new WebSocket(currentUrl, [bearerProtocol(currentToken)]);
  } catch (err) {
    console.error('realtime connect failed', currentUrl, err);
    setRealtimeState({ connected: false });
    scheduleReconnect();
    return;
  }
  ws = sock;
  self._realtime = sock;

  sock.onmessage = (ev) => {
    let frame;
    try { frame = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
    if (!frame?.type) return;

    // Every per-user stream is opened server-side from the token's claims, so
    // there is nothing to subscribe to and no uuid to send.
    switch (frame.type) {
      case 'welcome':
        setRealtimeState({ connected: true, cable_ready: !!frame.cable_ready });
        break;
      case 'notification':
        handleNotification(frame.message);
        break;
      case 'user.state':
        // Live agent state; the BFF already folded the deltas into `view`.
        broadcast({ event: 'state', op: frame.message });
        break;
    }
  };

  sock.onclose = () => {
    if (ws === sock) { ws = null; setRealtimeState({ connected: false }); scheduleReconnect(); }
  };
  sock.onerror = (err) => console.error('realtime socket error', err);
}

// MV3 kills an idle service worker in ~30s. Incoming socket traffic resets that
// timer (Chrome 116+), and the realtime server pings on its own schedule, so the
// connection is what keeps the worker alive.
function scheduleReconnect() {
  if (!currentUuid || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; openSocket(); }, 3000);
}

function disconnect() {
  lastCall = null;
  currentUuid = '';
  currentToken = '';
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const sock = ws;
  ws = null;
  self._realtime = null;
  if (sock) { try { sock.close(); } catch { /* already closed */ } }
  setRealtimeState({ connected: false });
}

function handleNotification(data) {
  const route = routeNotification(data);
  if (route.kind === 'tab') openTab(route.url);
  else if (route.kind === 'call') { lastCall = { event: route.event, call: route.call }; broadcast(callFrame(lastCall)); }
  else if (route.kind === 'other') broadcast({ event: 'notification', data });
}

// The screen pop. A new tab every time; the id of the last one is kept, as the
// Angular worker did.
function openTab(url) {
  chrome.tabs.create({ url }, (tab) => { popTabId = tab?.id || popTabId; });
}
