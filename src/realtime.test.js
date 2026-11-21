import { describe, expect, it } from 'vitest';
import { BEARER_PREFIX, bearerProtocol, callFrame, realtimeUrl, routeNotification } from './realtime.js';

describe('realtimeUrl', () => {
  it('follows the domain scheme: https -> wss, http -> ws', () => {
    expect(realtimeUrl('https://portal.example')).toBe('wss://portal.example/ws/events');
    expect(realtimeUrl('http://localhost:4001')).toBe('ws://localhost:4001/ws/events');
  });

  it('drops trailing slashes', () => {
    expect(realtimeUrl('https://portal.example///')).toBe('wss://portal.example/ws/events');
  });
});

describe('bearerProtocol', () => {
  it('is base64url and unpadded, so the server can decode it', () => {
    // "??>" encodes to "Pz8+" in plain base64: both + and / cases, plus padding below
    const p = bearerProtocol('a?>~');
    expect(p.startsWith(BEARER_PREFIX)).toBe(true);
    expect(p.slice(BEARER_PREFIX.length)).not.toMatch(/[+/=]/);
    const back = atob(p.slice(BEARER_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/').padEnd(8, '='));
    expect(back).toBe('a?>~');
  });
});

describe('routeNotification', () => {
  it('opens a tab for the legacy tab:new', () => {
    expect(routeNotification({ action: 'tab:new', url: 'https://crm/x' })).toEqual({ kind: 'tab', url: 'https://crm/x' });
  });

  it('does not open a tab without a url', () => {
    expect(routeNotification({ action: 'tab:new' }).kind).toBe('other');
  });

  it('maps legacy call actions', () => {
    expect(routeNotification({ action: 'call:answer', call: { uuid: 'c1' } }))
      .toEqual({ kind: 'call', event: 'call:answer', call: { uuid: 'c1' } });
  });

  it('maps the current shape and carries the screen onto the call', () => {
    const r = routeNotification({ type: 'agent', message: { type: 'ringing', call: { uuid: 'c2' }, screen: { uuid: 's1' } } });
    expect(r).toEqual({ kind: 'call', event: 'call:ringing', call: { uuid: 'c2', screen: { uuid: 's1' } } });
  });

  it('ignores a current-shape message of another type, as the Angular worker did', () => {
    expect(routeNotification({ message: { type: 'reminder' } }).kind).toBe('ignored');
  });

  it('passes anything else on', () => {
    expect(routeNotification({ foo: 1 })).toEqual({ kind: 'other', data: { foo: 1 } });
  });
});

describe('callFrame', () => {
  it('keeps the envelope event separate from the call status', () => {
    expect(callFrame({ event: 'call:hangup', call: { uuid: 'c' } }))
      .toEqual({ event: 'call', status: 'call:hangup', call: { uuid: 'c' } });
  });
});
