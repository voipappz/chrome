import { test, expect, chromium } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const EXT = path.resolve(__dirname, '../../angular/dist');
const DOMAIN = process.env.TEST_DOMAIN!;
const USER = process.env.TEST_USERNAME!;
const PASS = process.env.TEST_PASSWORD!;

/**
 * The screen pop, end to end, against a REAL stack — no mocks anywhere.
 *
 *   voipappz-api  ──NATS notifications.<uuid>──>  realtime server
 *                 ──/ws/events──>  this extension  ──>  a tab opens
 *
 * The decision to pop lives in the API (ScreenPopPopNode); the realtime server
 * only relays; the extension only opens what it is told. This asserts the whole
 * chain rather than any one hop, which is the only way the seams get tested.
 *
 * Gated on TEST_RECEIVE=1 because it needs a running stack it can publish
 * into — a realtime server at TEST_DOMAIN, and a docker daemon holding the
 * API container. Run it locally with:
 *
 *   TEST_RECEIVE=1 TEST_DOMAIN=http://127.0.0.1:4001 \
 *   TEST_USERNAME=… TEST_PASSWORD=…  npx playwright test real-receive
 *
 * TEST_DOMAIN may be http (a plain local server) or https (behind a proxy that
 * terminates TLS) — the worker follows the scheme, and a mismatch there is a
 * socket that silently never opens.
 */
test('a tab:new published by the API opens a tab in the extension', async () => {
  test.skip(process.env.TEST_RECEIVE !== '1',
    'set TEST_RECEIVE=1 with a running stack (see the comment above)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-elixir-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: false,
    args: ['--headless=new', '--no-sandbox', '--ignore-certificate-errors',
           `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
    const id = sw.url().split('/')[2];

    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/index.html#/main`);
    await page.waitForURL(/login/);
    await page.locator('input[formcontrolname="domain"]').fill(DOMAIN);
    await page.locator('input[formcontrolname="username"]').fill(USER);
    await page.locator('input[formcontrolname="password"]').fill(PASS);
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page).toHaveURL(/main/, { timeout: 20_000 });

    const uuid = await page.evaluate(() => localStorage.getItem('_id'));
    console.log('  logged in, user_uuid =', uuid);

    // The socket must be OPEN before publishing: the relay does not replay, so
    // anything sent before the subscription lands is simply not delivered.
    const live = await sw.evaluate(() => new Promise<boolean>((resolve) => {
      const ok = () => { const s = (self as any)._realtime; return !!s && s.readyState === 1; };
      if (ok()) return resolve(true);
      const i = setInterval(() => { if (ok()) { clearInterval(i); resolve(true); } }, 300);
      setTimeout(() => { clearInterval(i); resolve(false); }, 20_000);
    }));
    console.log('  realtime socket open:', live);
    expect(live, 'worker never opened /ws/events').toBe(true);

    const url = `${DOMAIN}/record/elixir-tab`;
    // Exactly what ScreenPopPopNode publishes — the decision stays in the API.
    const ruby = `
require_relative 'lib/application'
require 'nats/io/client'
$nats = NATS::IO::Client.new
$nats.connect(servers: [ENV['NATS_URL']], connect_timeout: 3)
Mediators::Broadcast::Nats.publish(service: 'notifications', uuid: '${uuid}',
  payload: { action: 'tab:new', url: '${url}' })
$nats.flush(2)
`;
    const opened = ctx.waitForEvent('page', { timeout: 20_000 });
    execFileSync('docker', ['exec', '-e', `RB=${ruby}`, 'va-app', 'sh', '-c',
      'cd /opt/va-voipbox-api && bundle exec ruby -e "$RB"'],
      { stdio: 'pipe' });
    console.log('  API published notifications.' + uuid);

    const tab = await opened;
    await tab.waitForURL(/elixir-tab/, { timeout: 15_000, waitUntil: 'commit' });
    console.log('  extension opened:', tab.url());
    expect(tab.url()).toContain('elixir-tab');
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
