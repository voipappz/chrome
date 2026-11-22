import { describe, expect, it } from 'vitest';
import { CABLE_PROTOCOL, cableUrl, classify, identifiers, redact, subscribeCommand, withToken } from './cable.js';

describe('cableUrl', () => {
  it('is <api>/cable with the scheme following the API', () => {
    expect(cableUrl('https://switch.voipappz.io')).toBe('wss://switch.voipappz.io/cable');
    expect(cableUrl('http://localhost:5000/')).toBe('ws://localhost:5000/cable');
  });

  it('prefers an explicit cable URL', () => {
    expect(cableUrl('https://api.example', 'wss://node.example/cable')).toBe('wss://node.example/cable');
    expect(cableUrl('https://api.example', 'https://node.example/cable')).toBe('wss://node.example/cable');
  });
});

describe('the token', () => {
  it('goes in ?token=, encoded, and is masked for logs', () => {
    const url = withToken('wss://n/cable', 'a.b+c');
    expect(url).toBe('wss://n/cable?token=a.b%2Bc');
    expect(withToken('wss://n/cable?x=1', 't')).toBe('wss://n/cable?x=1&token=t');
    expect(redact(url)).toBe('wss://n/cable?token=***');
  });
});

describe('identifiers', () => {
  it('match the Angular build, user_uuid included for older nodes', () => {
    const ids = identifiers('u1');
    expect(ids.notifications).toBe('{"channel":"Notifications","user_uuid":"u1"}');
    expect(JSON.parse(ids.state)).toEqual({ channel: 'StateChannel', scope: 'user', id: 'u1' });
  });

  it('subscribes with the exact identifier string', () => {
    const ids = identifiers('u1');
    expect(JSON.parse(subscribeCommand(ids.notifications))).toEqual({ command: 'subscribe', identifier: ids.notifications });
  });
});

describe('classify', () => {
  const ids = identifiers('u1');
  const frame = (o) => JSON.stringify(o);

  it('recognises the protocol frames', () => {
    expect(classify(frame({ type: 'welcome' }), ids).kind).toBe('welcome');
    expect(classify(frame({ type: 'ping', message: 1 }), ids).kind).toBe('ping');
    expect(classify(frame({ type: 'confirm_subscription', identifier: ids.notifications }), ids))
      .toEqual({ kind: 'confirm', identifier: ids.notifications });
    expect(classify(frame({ type: 'reject_subscription', identifier: ids.state }), ids))
      .toEqual({ kind: 'reject', identifier: ids.state });
  });

  it('reads reconnect:false on disconnect as a refusal, and defaults to retry', () => {
    expect(classify(frame({ type: 'disconnect', reason: 'unauthorized', reconnect: false }), ids))
      .toEqual({ kind: 'disconnect', reason: 'unauthorized', reconnect: false });
    expect(classify(frame({ type: 'disconnect', reason: 'restart' }), ids).reconnect).toBe(true);
  });

  it('routes data by identifier', () => {
    expect(classify(frame({ identifier: ids.notifications, message: { action: 'tab:new' } }), ids))
      .toEqual({ kind: 'notification', message: { action: 'tab:new' } });
    expect(classify(frame({ identifier: ids.state, message: { op: 1 } }), ids))
      .toEqual({ kind: 'state', message: { op: 1 } });
  });

  it('ignores frames for other subscriptions and garbage', () => {
    expect(classify(frame({ identifier: '{"channel":"Other"}', message: {} }), ids).kind).toBe('unknown');
    expect(classify('not json', ids).kind).toBe('unknown');
  });

  it('asks for the protocol the server requires', () => {
    expect(CABLE_PROTOCOL).toBe('actioncable-v1-json');
  });
});
