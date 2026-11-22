/**
 * The pure half of the ActionCable client: the URL, the subscriptions, and what
 * each frame from the server means. No sockets and no chrome.* here, so all of
 * it is unit-tested (cable.test.js); background.js does the I/O.
 *
 * Why cable and not NATS directly: cable admits the socket with the agent's own
 * login token, and the node's Notifications channel streams the user that token
 * belongs to, ignoring anything the client claims
 * (va-crystal node/realtime/app.cr, `class Notifications`). NATS can only check
 * a fixed username and password, which a Chrome extension cannot keep secret.
 * Cable is NATS-backed (Cable::NATSBackend), so the events are the same.
 * Protocol notes: CABLE_CONTRACT.md.
 */

// REQUIRED: the server speaks only this subprotocol, and a socket that does not
// ask for it is dropped before `welcome`, which reads exactly like a bad token.
export const CABLE_PROTOCOL = 'actioncable-v1-json';

// The server pings every 3s. Two missed pings and the link is treated as dead
// (half-open sockets are common on laptops that slept), as @rails/actioncable's
// ConnectionMonitor does.
export const STALE_AFTER_MS = 7000;

/**
 * Where the socket goes: `wss://<api host>/cable` unless a cable URL is given,
 * with the scheme FOLLOWING the API's (http -> ws for a local stack). The token
 * goes in `?token=`: browsers cannot set headers on a WebSocket handshake, and
 * the node reads it from there.
 */
export function cableUrl(apiBase, explicit) {
  const base = (explicit || `${(apiBase || '').replace(/\/+$/, '')}/cable`).trim();
  if (/^wss?:\/\//.test(base)) return base;
  return base.startsWith('http://') ? base.replace(/^http:\/\//, 'ws://') : base.replace(/^https?:\/\//, 'wss://');
}

export const withToken = (url, token) => `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`;

/** The same URL with the token masked, for logs and for the test hook. */
export const redact = (url) => (url ? url.replace(/token=[^&]+/, 'token=***') : url);

/**
 * The subscriptions, as the Angular build's cable client sent them
 * (voipappz/chrome@c3df82b). An identifier is matched by its EXACT JSON string
 * (the server echoes it back verbatim), so these are built once and compared as
 * strings; key order is part of the identity.
 *
 * `user_uuid` on Notifications is ignored by current nodes, which stream the
 * user verified by the token (va-crystal node/realtime/app.cr). It is still
 * sent because an older node picks the stream from it.
 */
export function identifiers(userUuid) {
  return {
    notifications: JSON.stringify({ channel: 'Notifications', user_uuid: userUuid }),
    state: JSON.stringify({ channel: 'StateChannel', scope: 'user', id: userUuid }),
  };
}

export const subscribeCommand = (identifier) => JSON.stringify({ command: 'subscribe', identifier });

/**
 * One frame from the server, classified:
 *   welcome | ping | confirm | reject | disconnect   protocol traffic (`type`)
 *   notification | state                            data, by identifier
 *   unknown                                          anything else
 */
export function classify(raw, ids) {
  let frame;
  try { frame = JSON.parse(typeof raw === 'string' ? raw : ''); } catch { return { kind: 'unknown' }; }
  if (!frame || typeof frame !== 'object') return { kind: 'unknown' };

  switch (frame.type) {
    case 'welcome': return { kind: 'welcome' };
    case 'ping': return { kind: 'ping' };
    case 'confirm_subscription': return { kind: 'confirm', identifier: frame.identifier };
    case 'reject_subscription': return { kind: 'reject', identifier: frame.identifier };
    case 'disconnect': return { kind: 'disconnect', reason: frame.reason, reconnect: frame.reconnect !== false };
    default: break;
  }
  if (ids && frame.identifier === ids.notifications) return { kind: 'notification', message: frame.message };
  if (ids && frame.identifier === ids.state) return { kind: 'state', message: frame.message };
  return { kind: 'unknown' };
}
