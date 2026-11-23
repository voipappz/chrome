import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from './config.js';
import { cableEndpoint, endpoint } from './session.js';

afterEach(() => localStorage.clear());

describe('where this build connects', () => {
  it('logs in at the switch API and opens the switch cable', () => {
    expect(CONFIG.API_ENDPOINT).toBe('https://switch.voipappz.io');
    expect(endpoint()).toBe('https://switch.voipappz.io');
    expect(cableEndpoint()).toBe('wss://switch.voipappz.io/cable');
  });

  it('a _domain override moves cable with it (the e2e specs aim at a fake node)', () => {
    localStorage.setItem('_domain', 'https://localhost:4443');
    expect(cableEndpoint()).toBe('wss://localhost:4443/cable');
  });

  it('a runtime _cable override still wins', () => {
    localStorage.setItem('_cable', 'wss://localhost:1234/cable');
    expect(cableEndpoint()).toBe('wss://localhost:1234/cable');
  });
});
