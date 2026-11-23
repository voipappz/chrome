import { customerConfig } from './customers.js';

// WHERE THIS BUILD TALKS TO, and whose it is: the customer picked at build
// time (EXT_CUSTOMER, see customers.js). Vite bakes the choice in as
// __EXT_CUSTOMER__; Node (manifest.config.js, scripts) reads the environment.
//
// Login and REST go to API_ENDPOINT; the realtime socket to CABLE_URL.
// `localStorage._domain` (and `_cable`) override them at runtime: that is how
// the e2e specs aim the extension at a fake node.
/* global __EXT_CUSTOMER__ */
const key = typeof __EXT_CUSTOMER__ !== 'undefined' ? __EXT_CUSTOMER__ : globalThis.process?.env?.EXT_CUSTOMER;

export const CONFIG = customerConfig(key);
