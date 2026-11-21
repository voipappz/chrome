/**
 * The pure half of the realtime client: where the socket goes, how it
 * authenticates, and what each notification means. No sockets and no chrome.*
 * here, so all of it is unit-tested (realtime.test.js); background.js does the
 * I/O. The wire contract is extension/REALTIME_CONTRACT.md.
 */

// The token travels as a SUBPROTOCOL, not a query parameter: browsers cannot
// set Authorization on a WebSocket handshake, and a URL is recorded by every
// reverse proxy and access log in between.
export const BEARER_PREFIX = 'voipappz-bearer.';

/** base64url, unpadded: the server maps -/_ back and re-pads, so + / = must not appear. */
export function bearerProtocol(token) {
  const encoded = btoa(token || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return BEARER_PREFIX + encoded;
}

/**
 * The portal's /ws/events, with the scheme FOLLOWING the domain's: https ->
 * wss, http -> ws. Forcing wss at a plaintext server is a TLS handshake against
 * a port that speaks none, which surfaces as a socket that never opens.
 */
export function realtimeUrl(domain) {
  const d = (domain || '').replace(/\/+$/, '');
  const ws = d.startsWith('http://') ? d.replace(/^http:\/\//, 'ws://') : d.replace(/^https?:\/\//, 'wss://');
  return `${ws}/ws/events`;
}

const CALL_EVENTS = { ringing: 'call:ringing', answer: 'call:answer', hangup: 'call:hangup' };

/**
 * What a `notification` frame's `message` asks for:
 *
 *   { kind: 'tab', url }          open a tab (the screen pop)
 *   { kind: 'call', event, call } the call card changes
 *   { kind: 'other', data }       anything else, passed on to listeners
 *
 * Two payload shapes arrive and both are honoured:
 *   legacy:  { action: 'tab:new', url } | { action: 'call:ringing', call }
 *   current: { type: 'agent', message: { type: 'ringing', call, screen } }
 */
export function routeNotification(data) {
  if (!data || typeof data !== 'object') return { kind: 'other', data };

  if (data.action === 'tab:new' && data.url) return { kind: 'tab', url: data.url };
  if (Object.values(CALL_EVENTS).includes(data.action)) return { kind: 'call', event: data.action, call: data.call };

  const message = data.message;
  if (message && typeof message === 'object' && message.type) {
    const event = CALL_EVENTS[message.type];
    if (event) return { kind: 'call', event, call: { ...(message.call || {}), screen: message.screen } };
    // A current-shape message of another type (redirect, reminder...) was
    // swallowed by the Angular worker; kept that way.
    return { kind: 'ignored', data };
  }

  return { kind: 'other', data };
}

/** The envelope's `event` says what kind of message; the call's own state is `status`. */
export const callFrame = (lastCall) => ({ event: 'call', status: lastCall.event, call: lastCall.call });

/** The popup's card label for a call status. */
export const CALL_STATUS_LABEL = { 'call:ringing': 'ringing', 'call:answer': 'answer', 'call:hangup': 'hangup' };
