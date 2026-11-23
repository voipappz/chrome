import { test, expect } from '@playwright/test';
import { chromium, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { customerConfig } from '../../src/customers.js';

/**
 * THE REAL SWITCH, the way an agent uses it: the built extension in a real
 * Chrome, a real agent signs in at the build customer's API, and the worker
 * opens that customer's cable -- green only once the server welcomed
 * the socket and confirmed Notifications, i.e. a screen pop could arrive.
 *
 * Needs TEST_USERNAME / TEST_PASSWORD (an agent's USER login; CI reads them
 * from the repository secrets) and is skipped without them. No _domain
 * override: this is the build's own configuration, end to end.
 */
const EXT = path.resolve(import.meta.dirname, '../../dist');
// The customer the extension in dist/ was built for (EXT_CUSTOMER): its own
// API and cable, checked as they are -- no override.
const C = customerConfig(process.env.EXT_CUSTOMER);
const USER = process.env.TEST_USERNAME ?? '';
const PASS = process.env.TEST_PASSWORD ?? '';
const NATS = !!(process.env.NATS_TOKEN || process.env.NATS_USER);

test.describe(`Live: the real ${C.CUSTOMER} server (${C.API_ENDPOINT})`, () => {
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

  // No credential needed: a wrong password must come back as the server's own
  // refusal, shown in the popup -- proof the build's sign-in reaches ITS API
  // from the extension (address, TLS, CORS), not just that the server is up.
  test('a wrong password gets the server\'s own refusal in the popup', async () => {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${sw.url().split('/')[2]}/index.html#/login`);
    await popup.locator('input[name="username"]').fill(`nobody-${Date.now()}@example.invalid`);
    await popup.locator('input[name="password"]').fill('not-the-password');
    await popup.getByRole('button', { name: /^sign in$/i }).click();
    await expect(popup.getByTestId('login-error')).toHaveText(/invalid email or password/i, { timeout: 15_000 });
    await popup.close();
  });

  test('an agent signs in and the cable goes green', async () => {
    test.skip(!USER || !PASS, `set TEST_USERNAME and TEST_PASSWORD (a ${C.CUSTOMER} agent login) to sign in for real`);
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
    const id = sw.url().split('/')[2];

    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${id}/index.html#/main`);
    await popup.waitForURL(/login/);
    await popup.locator('input[name="username"]').fill(USER);
    await popup.locator('input[name="password"]').fill(PASS);
    await popup.getByRole('button', { name: /^sign in$/i }).click();

    // A refused login shows the API's message instead of moving on.
    await expect(popup, 'the switch did not accept the login').toHaveURL(/main/, { timeout: 20_000 });
    await expect(popup.getByTestId('conn-dot')).toHaveAttribute('data-state', 'on', { timeout: 30_000 });

    // The worker went to the build's own cable, not anywhere else.
    expect(await sw.evaluate(() => (self as any)._cable_url)).toBe(C.CABLE_URL);
  });

  // THE WHOLE PATH: NATS -> the node's cable -> the extension -> a tab. The
  // screen pop is published exactly as the platform does it (notifications:
  // <uuid> on the customer's wss://<host>/nats), to this test agent only.
  test('a screen pop published on NATS opens its tab', async () => {
    test.skip(!USER || !PASS || !NATS, 'needs an agent login and NATS_USER/NATS_PASSWORD or NATS_TOKEN');
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
