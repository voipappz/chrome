import { describe, expect, it } from 'vitest';
import { callFrame, routeNotification } from './realtime.js';

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
