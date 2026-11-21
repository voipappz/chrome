import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from './config.js';
import {
  currentSession, endpoint, forgetSession, healStaleSession, isAuthenticated, rememberCredentials,
  rememberedCredentials, rememberSession,
} from './session.js';

afterEach(() => localStorage.clear());

describe('endpoint', () => {
  it('defaults to the compiled endpoint', () => {
    expect(endpoint()).toBe(CONFIG.API_ENDPOINT);
  });

  it('honours the _domain override and keeps its scheme', () => {
    localStorage.setItem('_domain', 'http://localhost:4001/');
    expect(endpoint()).toBe('http://localhost:4001');
  });

  it('adds https to a bare host', () => {
    localStorage.setItem('_domain', 'portal.example');
    expect(endpoint()).toBe('https://portal.example');
  });
});

describe('session', () => {
  it('is remembered with the endpoint it belongs to', () => {
    rememberSession('https://portal.example', { token: 't', userUuid: 'u' });
    expect(currentSession()).toEqual({ token: 't', userUuid: 'u' });
    expect(isAuthenticated()).toBe(true);
    expect(localStorage.getItem('_domain_source')).toBe(CONFIG.API_ENDPOINT);
  });

  it('logout forgets the token and the stored credentials', () => {
    rememberSession('https://portal.example', { token: 't', userUuid: 'u' });
    rememberCredentials('a@b', 'pw');
    forgetSession();
    expect(isAuthenticated()).toBe(false);
    expect(rememberedCredentials()).toEqual({ username: '', password: '' });
  });
});

describe('healStaleSession', () => {
  it('drops a session minted against a different endpoint', () => {
    rememberSession('https://old.example', { token: 't', userUuid: 'u' });
    rememberCredentials('a@b', 'pw');
    localStorage.setItem('_domain_source', 'https://old.example');
    healStaleSession();
    expect(isAuthenticated()).toBe(false);
    expect(localStorage.getItem('_domain')).toBeNull();
    expect(rememberedCredentials().password).toBe('');
  });

  it('keeps a session from the current endpoint', () => {
    rememberSession(CONFIG.API_ENDPOINT, { token: 't', userUuid: 'u' });
    healStaleSession();
    expect(isAuthenticated()).toBe(true);
  });

  it('leaves a bare _domain override alone (the e2e specs rely on it)', () => {
    localStorage.setItem('_domain', 'https://fake.node');
    healStaleSession();
    expect(localStorage.getItem('_domain')).toBe('https://fake.node');
  });
});
