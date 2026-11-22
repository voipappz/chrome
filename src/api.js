import { currentSession, endpoint } from './session.js';

/**
 * The three calls the popup makes, against `endpoint()`. Plain fetch, not the
 * app's apiService: that one resolves the base URL and token from the app's
 * own storage keys, and the extension's session lives under different ones
 * (see session.js) and points at a different host.
 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, params, auth = true } = {}) {
  const url = new URL(endpoint() + path);
  if (params) url.search = serialize(params);
  const headers = {};
  if (auth) headers.Authorization = currentSession().token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(data?.message || data?.error || `HTTP ${res.status}`, res.status);
  return data;
}

/**
 * POST /auth/user_login: the USER front door (users table), not the account
 * one. Credentials in the body only: a query string is written to every proxy
 * and access log on the way, password included.
 */
export function login(email, password) {
  return request('/auth/user_login', { method: 'POST', body: { email, password }, auth: false });
}

export const getUser = (uuid) => request(`/api/users/${uuid}`);

export const getBreakStatuses = () => request('/api/statuses', { params: { search: { type: 'on_break' } } });

export const hangUp = (callUuid) => request(`/v1/calls/${callUuid}`, { method: 'DELETE' });

/**
 * Rails-style nested params: { search: { type: 'x' } } -> search[type]=x,
 * arrays of strings -> key[]=v. Same encoding the Angular HandleRequestService
 * used, so the API sees identical query strings.
 */
export function serialize(obj, prefix) {
  const parts = [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const k = prefix
      ? Array.isArray(obj)
        ? typeof value === 'string' ? `${prefix}[]` : `${prefix}[${key}]`
        : `${prefix}[${encodeURIComponent(key)}]`
      : encodeURIComponent(key);
    parts.push(value !== null && typeof value === 'object' ? serialize(value, k) : `${k}=${value}`);
  }
  return parts.join('&');
}
