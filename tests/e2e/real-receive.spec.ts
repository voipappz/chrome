import { test, expect } from '@playwright/test';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * The receive path against a REAL platform: sign in, hold a live NATS
 * connection, then have the API publish an actual notification and assert the
 * extension opens the tab. mock-realtime.spec.ts proves the extension's own
 * logic against a fake; this proves the platform delivers — installer, API,
 * broker, edge, all of it.
 *
 * Gated behind TEST_RECEIVE=1 because it needs what only a disposable
 * environment should have: a node whose NATS accepts the extension's
 * credential (the shipped nats.conf deliberately does not), and a docker
 * daemon holding that node's va-app to publish through. The mothership CI
 * health-check job is exactly that environment.
 *
 *   TEST_RECEIVE=1  TEST_DOMAIN=https://127.0.0.1 \
 *   TEST_USERNAME=… TEST_PASSWORD=… [PUBLISH_SUDO=1]  npx playwright test real-receive
 */
const EXT = path.resolve(__dirname, '../../angular/dist');
const DOMAIN = process.env.TEST_DOMAIN ?? '';
const USERNAME = process.env.TEST_USERNAME ?? '';
const PASSWORD = process.env.TEST_PASSWORD ?? '';

test.describe('Receive against a real platform', () => {
  test.skip(process.env.TEST_RECEIVE !== '1',
    'set TEST_RECEIVE=1 (plus TEST_DOMAIN/USERNAME/PASSWORD) on a disposable node whose NATS accepts the extension credential');

  let ctx: BrowserContext;
  let dir: string;

  test.afterAll(async () => {
    await ctx?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a notification published by the API opens the tab', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-recv-'));
    ctx = await chromium.launchPersistentContext(dir, {
      headless: false,
      args: ['--headless=new', '--no-sandbox', '--ignore-certificate-errors',
             `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    let sw: Worker = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
    const id = sw.url().split('/')[2];

    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/index.html#/main`);
    await page.waitForURL(/login/);
    await page.locator('input[formcontrolname="domain"]').fill(DOMAIN);
    await page.locator('input[formcontrolname="username"]').fill(USERNAME);
    await page.locator('input[formcontrolname="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page).toHaveURL(/main/, { timeout: 20_000 });

    const uuid = await page.evaluate(() => localStorage.getItem('_id'));
    expect(uuid, 'login stored no _id').toBeTruthy();

    // Live on the broker, not just logged in: _nats is set only after
    // connect() resolves (backgroundPage.ts).
    const live = await sw.evaluate(() => new Promise<boolean>((resolve) => {
      const ok = () => { const nc = (self as any)._nats; return !!nc && nc.isClosed() === false; };
      if (ok()) return resolve(true);
      const i = setInterval(() => { if (ok()) { clearInterval(i); resolve(true); } }, 300);
      setTimeout(() => { clearInterval(i); resolve(false); }, 25_000);
    }));
    expect(live, `worker never connected to ${DOMAIN.replace(/^https?/, 'wss')}/nats — is the extension NATS user configured on this node?`).toBe(true);

    // Publish through the API's own mediator, in its own container — the same
    // call the screen-pop PocketFlow node makes. $nats is established by the
    // Puma boot, not by `ruby -e`, and the mediator silently no-ops without it
    // (best-effort by design), so the publisher brings its own connection.
    const url = `${DOMAIN}/e2e-popped`;
    const ruby = `
require_relative 'lib/application'
require 'nats/io/client'
$nats = NATS::IO::Client.new
$nats.connect(servers: [ENV['NATS_URL']], connect_timeout: 3)
Mediators::Broadcast::Nats.publish(service: 'notifications', uuid: '${uuid}',
  payload: { action: 'tab:new', url: '${url}' })
$nats.flush(2)
`;
    const docker = ['exec', '-e', `RB=${ruby}`, 'va-app',
      'sh', '-c', 'cd /opt/va-voipbox-api && bundle exec ruby -e "$RB"'];
    const opened = ctx.waitForEvent('page', { timeout: 20_000 });
    if (process.env.PUBLISH_SUDO === '1') execFileSync('sudo', ['docker', ...docker], { stdio: 'pipe' });
    else execFileSync('docker', docker, { stdio: 'pipe' });

    const tab = await opened;
    expect(tab.url()).toContain('/e2e-popped');
  });
});
