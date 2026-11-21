import { defineConfig } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Loads dist/ into a real Chrome as an unpacked extension, so there is no
// server to start and the build must exist.
//
//   make test-e2e                 the offline specs (fake node)
//   make test-e2e SPEC=login TEST_DOMAIN=... TEST_USERNAME=... TEST_PASSWORD=...
const ROOT = import.meta.dirname;
if (!existsSync(resolve(ROOT, 'dist/manifest.json'))) {
  console.log('\n[extension e2e] building dist/ first');
  execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 1,
  // One Chrome per spec file, each with its own profile; parallel files would
  // fight over the fake node's ports and the stack's single user.
  workers: 1,
  reporter: 'list',
  outputDir: resolve(ROOT, 'test-results'),
  use: { trace: 'on-first-retry' },
});
