import { describe, expect, it } from 'vitest';
import { CUSTOMERS, customerConfig } from './customers.js';

describe('customer builds', () => {
  it('defaults to voipappz, the switch', () => {
    expect(customerConfig(undefined)).toEqual(CUSTOMERS.voipappz);
    expect(customerConfig('').API_ENDPOINT).toBe('https://switch.voipappz.io');
  });

  it('nimbus logs in at nimbus-prod and opens its cable', () => {
    const c = customerConfig('nimbus');
    expect(c.API_ENDPOINT).toBe('https://nimbus-prod.voipappz.io');
    expect(c.CABLE_URL).toBe('wss://nimbus-prod.voipappz.io/cable');
    expect(c.PAGE_TITLE).toBe('Nimbus');
  });

  it('an unknown customer fails, naming the ones that exist', () => {
    expect(() => customerConfig('nope')).toThrow(/voipappz, nimbus/);
  });

  it('every customer has https login and a wss cable on the same host', () => {
    for (const c of Object.values(CUSTOMERS)) {
      const api = new URL(c.API_ENDPOINT);
      const cable = new URL(c.CABLE_URL);
      expect(api.protocol).toBe('https:');
      expect(cable.protocol).toBe('wss:');
      expect(cable.host).toBe(api.host);
      expect(cable.pathname).toBe('/cable');
    }
  });
});
