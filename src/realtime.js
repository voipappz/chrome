/**
 * What each notification means: open a tab, update the call, or pass it on.
 * Pure, unit-tested in realtime.test.js. The payload is the Notifications
 * channel's `message`, unchanged from the Angular build.
 */

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
