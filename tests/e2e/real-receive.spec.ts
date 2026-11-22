import { test, expect, chromium } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const EXT = path.resolve(import.meta.dirname, '../../dist');
const DOMAIN = process.env.TEST_DOMAIN!;
const USER = process.env.TEST_USERNAME!;
const PASS = process.env.TEST_PASSWORD!;
const READY_FILE = process.env.SCREEN_POP_READY_FILE ?? '';

/**
 * The screen pop, end to end, against a REAL stack — no mocks anywhere.
 *
 *   voipappz-api ──NATS instruction load──> Elixir
 *   va-crystal ──Cable CallEvents─────────> Elixir /cable
 *                                           └─> this extension ──> a tab opens
 *
 * Ruby owns the loaded instruction; Elixir matches and executes it against the
 * enriched Crystal event; the extension only opens what it is told. This
 * asserts the whole chain without making TypeScript inspect Cable itself.
 *
 * Gated on TEST_RECEIVE=1 and coordinated through SCREEN_POP_READY_FILE. This
 * file owns only the browser side: it logs in, waits for `/cable`, writes
 * the verified user UUID to a private coordination file, and observes the tab.
 * A platform-side driver must load the Ruby instruction and publish the
 * enriched CallEvents message after that file appears.
 *
 * TEST_DOMAIN may be http (a plain local server) or https (behind a proxy that
 * terminates TLS) — the worker follows the scheme, and a mismatch there is a
 * socket that silently never opens.
 */
test('an incoming call opens the agent tab in the extension', async () => {
  test.skip(process.env.TEST_RECEIVE !== '1' || !READY_FILE,
    'run through scripts/screen-pop-e2e.sh (see the comment above)');

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
    await page.evaluate((d) => localStorage.setItem('_domain', d), DOMAIN);
    await page.locator('input[name="username"]').fill(USER);
    await page.locator('input[name="password"]').fill(PASS);
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page).toHaveURL(/main/, { timeout: 20_000 });

    const uuid = await page.evaluate(() => localStorage.getItem('_id'));
    console.log('  logged in, user_uuid =', uuid);

    // The socket must be OPEN before publishing: the relay does not replay, so
    // anything sent before the subscription lands is simply not delivered.
    const live = await sw.evaluate(() => new Promise<boolean>((resolve) => {
      const ok = () => { const s = (self as any)._cable; return !!s && s.readyState === 1; };
      if (ok()) return resolve(true);
      const i = setInterval(() => { if (ok()) { clearInterval(i); resolve(true); } }, 300);
      setTimeout(() => { clearInterval(i); resolve(false); }, 20_000);
    }));
    console.log('  realtime socket open:', live);
    expect(live, 'worker never opened /cable').toBe(true);

    // Arm the browser assertion before telling the shell driver which user is
    // ready. The driver publishes the enriched event through CallEvents;
    // TypeScript neither invokes Ruby nor connects to NATS/Cable.
    const contactId = 'contact-4242';
    expect(uuid, 'login stored no user UUID').toBeTruthy();
    const opened = ctx.waitForEvent('page', { timeout: 90_000 });
    fs.writeFileSync(READY_FILE, `${uuid}\n`, { mode: 0o600 });
    console.log('  browser ready for the screen-pop event');

    const tab = await opened;
    await tab.waitForURL(/contact-4242/, { timeout: 15_000, waitUntil: 'commit' });
    console.log('  extension opened:', tab.url());
    expect(tab.url()).toContain(contactId);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
