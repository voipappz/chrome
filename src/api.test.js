import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBreakStatuses, login, serialize } from './api.js';
import { secondsToString } from './timer.js';

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

const okFetch = (body) => vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });

describe('serialize', () => {
  it('encodes nested params the Rails way', () => {
    expect(serialize({ search: { type: 'on_break' } })).toBe('search[type]=on_break');
    expect(serialize({ ids: ['a', 'b'] })).toBe('ids[]=a&ids[]=b');
  });
});

describe('requests', () => {
  it('logs in without a token, at the user front door', async () => {
    localStorage.setItem('_domain', 'https://portal.example');
    localStorage.setItem('_token', 'stale');
    const fetch = okFetch({ token: 't', user: { uuid: 'u' } });
    vi.stubGlobal('fetch', fetch);
    await login('a@b.c', 'pw');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://portal.example/auth/user_login?email=a%40b.c&password=pw');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('sends the raw token as Authorization', async () => {
    localStorage.setItem('_domain', 'https://portal.example');
    localStorage.setItem('_token', 'tok');
    const fetch = okFetch([]);
    vi.stubGlobal('fetch', fetch);
    await getBreakStatuses();
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://portal.example/api/statuses?search[type]=on_break');
    expect(init.headers.Authorization).toBe('tok');
  });

  it('surfaces the server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('{"message":"Invalid credentials"}') }));
    await expect(login('x', 'y')).rejects.toThrow('Invalid credentials');
  });
});

describe('secondsToString', () => {
  it('formats like the Angular popup', () => {
    expect(secondsToString(0)).toBe('00:00:00');
    expect(secondsToString(65)).toBe('00:01:05');
    expect(secondsToString(3725)).toBe('1:02:05');
  });
});
