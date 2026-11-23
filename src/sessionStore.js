/**
 * The worker's own copy of the session, so it can reconnect by itself.
 *
 * Without it the worker held the session only in memory, and only an open
 * popup handed it over again. Chrome stops a worker whenever it likes (a
 * browser restart, an extension update, an evicted idle worker), so after any
 * of those the cable stayed closed and NO SCREEN-POP TAB OPENED until the agent
 * happened to open the popup.
 *
 * chrome.storage.local, not .session: .session is cleared when the browser
 * restarts, which is the main case this exists for. The popup already keeps
 * the same token in its localStorage, so this adds no new exposure. Cleared at
 * logout, and when the server refuses the token (so a restart does not keep
 * retrying a dead one).
 *
 * `area` is a chrome.storage area; passed in so the tests use a fake.
 */
export const SESSION_KEY = 'session';

export async function saveSession(area, { user_uuid, token, cable }) {
  if (!area || !user_uuid || !token || !cable) return;
  await area.set({ [SESSION_KEY]: { user_uuid, token, cable } });
}

/** The stored session, or null when there is none or it is incomplete. */
export async function loadSession(area) {
  if (!area) return null;
  const got = await area.get(SESSION_KEY);
  const s = got?.[SESSION_KEY];
  return s && typeof s === 'object' && s.user_uuid && s.token && s.cable ? s : null;
}

export async function clearSession(area) {
  if (!area) return;
  await area.remove(SESSION_KEY);
}
