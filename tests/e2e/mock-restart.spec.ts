import { test, expect } from '@playwright/test';
import { chromium, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { startFakeNode, type FakeNode } from './helpers/fake-node';

/**
 * RESTART RECOVERY against a mimicked node: the case that matters most for the
 * extension's one job. The agent signs in once; Chrome restarts; nobody opens
 * the popup; a screen pop arrives -- and the tab must open.
 *
 * The browser is really restarted: the context is closed and a new one is
 * launched on the SAME profile directory, so the worker starts cold and has
 * only what it stored (sessionStore.js). Serial: each test leaves the profile
 * in the state the next one starts from.
 */
const EXT = path.resolve(import.meta.dirname, '../../dist');
const launch = (dir: string) => chromium.launchPersistentContext(dir, {
  headless: false,
  args: ['--headless=new', '--no-sandbox', '--ignore-certificate-errors',
         `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
async function extensionId(ctx: BrowserContext) {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
  return sw.url().split('/')[2];
}

test.describe.configure({ mode: 'serial' });

test.describe('Restart recovery against a mimicked node', () => {
  let node: FakeNode;
  let dir: string;
  let ctx: BrowserContext | undefined;

  test.beforeAll(async () => {
    node = await startFakeNode();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-restart-'));
  });

  test.afterAll(async () => {
    await ctx?.close();
    await node?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('after a browser restart, with the popup never opened, a screen pop still opens its tab', async () => {
    // Sign in once, through the popup, as an agent does.
    ctx = await launch(dir);
    const id = await extensionId(ctx);
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${id}/index.html#/main`);
    await popup.waitForURL(/login/);
    await popup.evaluate((d) => localStorage.setItem('_domain', d), node.origin);
    await popup.locator('input[name="username"]').fill('ci@fake.local');
    await popup.locator('input[name="password"]').fill('anything');
    await popup.getByRole('button', { name: /login/i }).click();
    await expect(popup.getByTestId('conn-dot')).toHaveAttribute('data-state', 'on', { timeout: 20_000 });

    // Restart Chrome. The new browser opens NO extension page.
    const before = node.subscriptions.length;
    await ctx.close();
    ctx = await launch(dir);
    await extensionId(ctx);

    // The worker reconnects and resubscribes on its own...
    await expect.poll(() => node.subscriptions.length, { timeout: 30_000 }).toBeGreaterThan(before);
    expect(node.tokens.at(-1)).toBe('ci-fake-token');

    // ...and a screen pop opens its tab.
    const opened = ctx.waitForEvent('page', { timeout: 15_000 });
    expect(node.publish({ action: 'tab:new', url: `${node.origin}/after-restart` })).toBe(true);
    const tab = await opened;
    expect(tab.url()).toContain('/after-restart');
  });

  test('after logout, a restart does not sign the agent back in', async () => {
    const id = await extensionId(ctx!);
    const popup = await ctx!.newPage();
    await popup.goto(`chrome-extension://${id}/index.html#/main`);
    await popup.getByRole('button', { name: /logout/i }).click();
    await popup.waitForURL(/login/);

    const before = node.tokens.length;
    await ctx!.close();
    ctx = await launch(dir);
    await extensionId(ctx);
    // Longer than a reconnect would take (the worker restores at start).
    await new Promise((r) => setTimeout(r, 8_000));
    expect(node.tokens.length, 'the worker reconnected after the agent logged out').toBe(before);
  });
});
