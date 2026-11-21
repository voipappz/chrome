import { CONFIG } from './config.js';

/**
 * Which build this is, and whose.
 *
 * Every customer gets the same code and a different `CONFIG.API_ENDPOINT`, so
 * two packed .zips are indistinguishable by looking at them. The answer goes on
 * screen, on both the login page (a broken endpoint is the failure you cannot
 * get past to see the main one) and the main popup (where someone already is
 * when they call support).
 *
 * The version is read from the manifest at RUNTIME rather than duplicated in a
 * constant: a second copy can disagree with the one Chrome actually installed.
 */
export function buildStamp() {
  return `${CONFIG.CUSTOMER} · v${manifestVersion()}`;
}

/** The stamp plus the address it points at, for a tooltip. */
export function buildStampDetail() {
  return `${buildStamp()} — ${CONFIG.API_ENDPOINT}`;
}

function manifestVersion() {
  try {
    // `chrome` exists in the extension and is shimmed under `vite dev`; a build
    // served any other way shows the gap rather than crashing the page.
    return globalThis.chrome?.runtime?.getManifest?.().version || 'unknown';
  } catch {
    return 'unknown';
  }
}
