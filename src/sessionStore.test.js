import { describe, expect, it } from 'vitest';
import { SESSION_KEY, clearSession, loadSession, saveSession } from './sessionStore.js';

// A chrome.storage area with the same promise API.
function fakeArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (obj) => { Object.assign(data, obj); },
    remove: async (key) => { delete data[key]; },
  };
}

const session = { user_uuid: 'u1', token: 't1', cable: 'wss://switch.example/cable' };

describe('sessionStore', () => {
  it('saves and loads the session', async () => {
    const area = fakeArea();
    await saveSession(area, session);
    expect(await loadSession(area)).toEqual(session);
  });

  it('keeps only what the worker needs', async () => {
    const area = fakeArea();
    await saveSession(area, { ...session, password: 'never' });
    expect(area.data[SESSION_KEY]).toEqual(session);
  });

  it('does not save an incomplete session', async () => {
    const area = fakeArea();
    await saveSession(area, { user_uuid: 'u1', token: '', cable: 'wss://x/cable' });
    expect(area.data[SESSION_KEY]).toBeUndefined();
  });

  it('loads nothing when nothing was stored, or it is incomplete or malformed', async () => {
    expect(await loadSession(fakeArea())).toBeNull();
    expect(await loadSession(fakeArea({ [SESSION_KEY]: { user_uuid: 'u1' } }))).toBeNull();
    expect(await loadSession(fakeArea({ [SESSION_KEY]: 'garbage' }))).toBeNull();
  });

  it('clears it', async () => {
    const area = fakeArea({ [SESSION_KEY]: session });
    await clearSession(area);
    expect(await loadSession(area)).toBeNull();
  });

  it('is a no-op without a storage area (the popup shim, tests)', async () => {
    await expect(saveSession(undefined, session)).resolves.toBeUndefined();
    expect(await loadSession(undefined)).toBeNull();
    await expect(clearSession(undefined)).resolves.toBeUndefined();
  });
});
