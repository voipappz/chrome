import { test, expect } from '@playwright/test';
import { chromium, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

/**
 * THE REAL SWITCH, the way an agent uses it: the built extension in a real
 * Chrome, a real agent signs in at https://switch.voipappz.io, and the worker
 * opens wss://switch.voipappz.io/cable -- green only once the server welcomed
 * the socket and confirmed Notifications, i.e. a screen pop could arrive.
 *
 * Needs TEST_USERNAME / TEST_PASSWORD (an agent's USER login; CI reads them
 * from the repository secrets) and is skipped without them. No _domain
 * override: this is the build's own configuration, end to end.
 */
const EXT = path.resolve(import.meta.dirname, '../../dist');
const USER = process.env.TEST_USERNAME ?? '';
const PASS = process.env.TEST_PASSWORD ?? '';
const NATS = !!(process.env.NATS_TOKEN || process.env.NATS_USER);

test.describe('Live: the real switch', () => {
  test.skip(!USER || !PASS, 'set TEST_USERNAME and TEST_PASSWORD (an agent login) to run against the real switch');

  let ctx: BrowserContext;
  let dir: string;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-live-'));
    ctx = await chromium.launchPersistentContext(dir, {
      headless: false,
      args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an agent signs in at switch.voipappz.io and the cable goes green', async () => {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
    const id = sw.url().split('/')[2];

    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${id}/index.html#/main`);
    await popup.waitForURL(/login/);
    await popup.locator('input[name="username"]').fill(USER);
    await popup.locator('input[name="password"]').fill(PASS);
    await popup.getByRole('button', { name: /login/i }).click();

    // A refused login shows the API's message instead of moving on.
    await expect(popup, 'the switch did not accept the login').toHaveURL(/main/, { timeout: 20_000 });
    await expect(popup.getByTestId('conn-dot')).toHaveAttribute('data-state', 'on', { timeout: 30_000 });

    // The worker went to the build's own cable, not anywhere else.
    expect(await sw.evaluate(() => (self as any)._cable_url)).toBe('wss://switch.voipappz.io/cable');
  });

  // THE WHOLE PATH: NATS -> the node's cable -> the extension -> a tab. The
  // screen pop is published exactly as the platform does it (notifications:
  // <uuid> on wss://switch.voipappz.io/nats), to this test agent only.
  test('a screen pop published on NATS opens its tab', async () => {
    test.skip(!NATS, 'set NATS_USER/NATS_PASSWORD or NATS_TOKEN to publish the screen pop through NATS');
    const popup = ctx.pages().find((p) => p.url().includes('#/main'));
    const uuid = await popup!.evaluate(() => localStorage.getItem('_id'));
    expect(uuid, 'the login stored no user uuid').toBeTruthy();

    const url = `https://example.com/?voipappz-screen-pop=${Date.now()}`;
    const opened = ctx.waitForEvent('page', { predicate: (p) => p.url().includes('voipappz-screen-pop'), timeout: 20_000 });
    execFileSync('node', [path.resolve(import.meta.dirname, '../../scripts/screen-pop.mjs'), uuid!, url], { stdio: 'inherit' });
    const tab = await opened;
    expect(tab.url()).toBe(url);
  });
});
