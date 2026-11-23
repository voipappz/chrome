// One entry per customer build: where it logs in, where its cable is, and how
// it names itself. The build picks one with EXT_CUSTOMER (default voipappz):
//
//   EXT_CUSTOMER=nimbus make build
//
// Every customer gets the same code; only these values differ, and they are
// stamped into the extension's name and the sign-in's build stamp, so an
// installed extension says whose it is.
export const CUSTOMERS = {
  voipappz: {
    CUSTOMER: 'voipappz',
    PAGE_TITLE: 'VoipAppz',
    API_ENDPOINT: 'https://switch.voipappz.io',
    CABLE_URL: 'wss://switch.voipappz.io/cable',
  },
  nimbus: {
    CUSTOMER: 'nimbus',
    PAGE_TITLE: 'Nimbus',
    API_ENDPOINT: 'https://nimbus-prod.voipappz.io',
    CABLE_URL: 'wss://nimbus-prod.voipappz.io/cable',
  },
};

export const DEFAULT_CUSTOMER = 'voipappz';

/** The entry for `key`, or an error naming the ones that exist. */
export function customerConfig(key) {
  const k = (key || DEFAULT_CUSTOMER).trim();
  const c = CUSTOMERS[k];
  if (!c) throw new Error(`EXT_CUSTOMER "${k}" is not one of: ${Object.keys(CUSTOMERS).join(', ')}`);
  return c;
}
