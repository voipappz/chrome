export const CONFIG = {
  // THE ONE KNOB. Every request the extension makes goes to the portal: it
  // performs the login (relaying to the API), serves /ws/events, and forwards
  // /api. There is no second host to configure, which is why the login form
  // does not ask for a domain.
  //
  // A deployment changes this line and nothing else. `localStorage._domain`
  // overrides it at runtime: that is how the e2e specs point the extension at
  // a fake node, and how you aim a packed build somewhere else without a
  // rebuild.
  API_ENDPOINT: 'https://nimbus-connectix.voipappz.io',
  // WHOSE DEPLOYMENT THIS BUILD IS FOR. Every customer gets the same code and
  // a different API_ENDPOINT, so a packed .zip is indistinguishable from any
  // other by looking at it. Stamped into the UI beside the version (see
  // buildStamp.js), so "which build is installed?" is answered on screen.
  //
  // It travels WITH the address: change one and change the other.
  CUSTOMER: 'nimbus',
  PAGE_TITLE: 'Nimbus',
};
