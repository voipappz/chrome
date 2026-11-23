import { defineManifest } from '@crxjs/vite-plugin';

// The source of truth for the extension's version. EXT_VERSION overrides it
// for a one-off build without a commit:
//
//   EXT_VERSION=0.0.11 make extension-pack
const SOURCE_VERSION = '0.0.10';

export default defineManifest(() => {
  const version = process.env.EXT_VERSION?.trim() || SOURCE_VERSION;

  // Chrome requires 1-4 dot-separated integers and refuses to load the
  // extension otherwise, with an error that names the manifest, not the build
  // that wrote it. Fail the build instead.
  if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(version)) {
    throw new Error(`manifest: "${version}" is not a valid Chrome version (1-4 dot-separated integers)`);
  }

  // "Nimbus10" for 0.0.10: the display name carries the patch, zero-padded to
  // two. Derived so the two cannot disagree; they once drifted silently and an
  // installed extension claimed a version it was not.
  const patch = version.split('.').at(-1);

  return {
    manifest_version: 3,
    name: `Nimbus${patch.padStart(2, '0')}`,
    short_name: 'nimbus',
    version,
    description: 'Screen pops and call state for VoipAppz agents',
    // storage: the worker's own copy of the session (sessionStore.js);
    // alarms: wakes a worker Chrome stopped, so it reconnects (restart recovery).
    permissions: ['tabs', 'storage', 'alarms'],
    // 116: from here incoming socket traffic keeps the worker alive.
    minimum_chrome_version: '116',
    action: { default_popup: 'index.html', default_title: 'Nimbus' },
    background: { service_worker: 'src/background.js', type: 'module' },
    content_scripts: [{ js: ['src/content.js'], matches: ['<all_urls>'] }],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };
});
