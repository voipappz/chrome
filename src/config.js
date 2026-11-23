export const CONFIG = {
  // WHERE THIS BUILD TALKS TO. Login and REST go to the API; the realtime
  // socket goes to cable, which is `<API_ENDPOINT>/cable` unless CABLE_URL
  // says otherwise (Kong proxies /cable to a live node). One pair per customer
  // build.
  //
  // `localStorage._domain` (and `_cable`) override them at runtime: that is how
  // the e2e specs aim the extension at a fake node, and how you point a packed
  // build somewhere else without a rebuild.
  API_ENDPOINT: 'https://switch.voipappz.io',
  // Named outright rather than derived, so the build says where it connects:
  // the switch's cable, which Kong proxies to a live node.
  CABLE_URL: 'wss://switch.voipappz.io/cable',
  // WHOSE DEPLOYMENT THIS BUILD IS FOR. Every customer gets the same code and
  // different addresses, so a packed .zip is indistinguishable from any other
  // by looking at it. Stamped into the UI beside the version (buildStamp.js)
  // and into the extension's name (manifest.config.js).
  //
  // It travels WITH the addresses: change one and change the others.
  CUSTOMER: 'voipappz',
  PAGE_TITLE: 'VoipAppz',
};
