import { CONFIG } from './config.js';
import { cableUrl } from './cable.js';

/**
 * The stored session, and the one rule that keeps it honest: a token belongs to
 * the server that minted it.
 *
 * An installed extension keeps its localStorage across an update, so a build
 * that moves `CONFIG.API_ENDPOINT` inherits the previous server's `_domain`,
 * `_token` and `_id`. Nothing rejects them locally (being signed in only asks
 * whether a token string exists), so the popup opens straight onto the main
 * page and every call goes to the old host. The portal is stricter: a foreign
 * token is refused at the socket handshake and Chrome reports "HTTP
 * Authentication failed; no valid credentials available".
 *
 * Hence `_domain_source`: the endpoint a session was established against. When
 * it no longer matches the compiled one, the session is from somewhere else and
 * is dropped, which puts the user back on the login form against the new host.
 *
 * A `_domain` with NO recorded source is left alone: that is the deliberate
 * runtime override the e2e specs seed to aim at a fake node.
 */
const DOMAIN = '_domain';
const CABLE = '_cable';
const SOURCE = '_domain_source';
const TOKEN = '_token';
const ID = '_id';
const USERNAME = '_username';
const PASSWORD = '_password';

export function healStaleSession() {
  const source = localStorage.getItem(SOURCE);
  if (!source || source === CONFIG.API_ENDPOINT) return;

  console.warn(`[session] endpoint moved ${source} → ${CONFIG.API_ENDPOINT}, dropping the old session`);
  [DOMAIN, SOURCE, TOKEN, ID, USERNAME, PASSWORD].forEach((key) => localStorage.removeItem(key));
}

/**
 * Where this extension talks to. The scheme is preserved rather than forced to
 * https, because the portal runs on plain http in development and forcing https
 * there produced a connection failure that read as a rejected login.
 */
export function endpoint() {
  const raw = (localStorage.getItem(DOMAIN) || CONFIG.API_ENDPOINT || '').trim();
  const d = raw.replace(/\/+$/, '');
  return /^https?:\/\//.test(d) ? d : `https://${d}`;
}

/** Where the realtime socket goes: `_cable`, else CONFIG.CABLE_URL, else `<endpoint>/cable`. */
export function cableEndpoint() {
  return cableUrl(endpoint(), localStorage.getItem(CABLE) || CONFIG.CABLE_URL);
}

/** Called on a successful login: stores the session and the endpoint it belongs to. */
export function rememberSession(domain, { token, userUuid }) {
  localStorage.setItem(TOKEN, token);
  localStorage.setItem(ID, userUuid);
  localStorage.setItem(DOMAIN, domain);
  localStorage.setItem(SOURCE, CONFIG.API_ENDPOINT);
}

export function currentSession() {
  return { token: localStorage.getItem(TOKEN) || '', userUuid: localStorage.getItem(ID) || '' };
}

export function isAuthenticated() {
  return currentSession().token !== '';
}

export function forgetSession() {
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(ID);
  forgetCredentials();
}

/**
 * Remembered sign-in, prefilled into the login form.
 *
 * A stored PASSWORD is a real trade: extension localStorage is plaintext on
 * disk, readable by anyone with the profile directory or devtools on this
 * extension. It is kept because signing in on every popup open is the thing
 * this replaces, and it is dropped by logout and by healStaleSession() along
 * with the rest of the session, so it never outlives the server it belongs to.
 */
export function rememberCredentials(username, password) {
  localStorage.setItem(USERNAME, username || '');
  localStorage.setItem(PASSWORD, password || '');
}

export function rememberedCredentials() {
  return {
    username: localStorage.getItem(USERNAME) || '',
    password: localStorage.getItem(PASSWORD) || '',
  };
}

export function forgetCredentials() {
  localStorage.removeItem(USERNAME);
  localStorage.removeItem(PASSWORD);
}
