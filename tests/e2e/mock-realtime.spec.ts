import { test, expect } from '@playwright/test';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { startFakeNode, type FakeNode } from './helpers/fake-node';

/**
 * The RECEIVE path against a mimicked node (helpers/fake-node.ts) — no real
 * node, broker, credential or secret, so unlike user-connect.spec.ts this
 * runs everywhere, including hosted CI.
 *
 * Own fixture rather than helpers/extension.ts because the realtime leg is
 * wss:// to a self-signed cert, which needs --ignore-certificate-errors.
 */
const EXT = path.resolve(__dirname, '../../angular/dist');

test.describe('Realtime against a mimicked node', () => {
  let node: FakeNode;
  let ctx: BrowserContext;
  let sw: Worker;
  let dir: string;

  test.beforeAll(async () => {
    node = await startFakeNode();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-mock-'));
    ctx = await chromium.launchPersistentContext(dir, {
      headless: false,
      args: ['--headless=new', '--no-sandbox', '--ignore-certificate-errors',
             `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
    const id = sw.url().split('/')[2];

    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/index.html#/main`);
    await page.waitForURL(/login/);
    await page.locator('input[formcontrolname="domain"]').fill(node.origin);
    await page.locator('input[formcontrolname="username"]').fill('ci@fake.local');
    await page.locator('input[formcontrolname="password"]').fill('anything');
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page).toHaveURL(/main/, { timeout: 20_000 });

    // Live means SUBscribed on the broker, not just navigated.
    await expect
      .poll(() => node.subs.has(`notifications.${node.userUuid}`)
               && node.subs.has(`state.user.${node.userUuid}`), { timeout: 20_000 })
      .toBe(true);
  });

  test.afterAll(async () => {
    await ctx?.close();
    await node?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the worker subscribes to its own subjects, from the typed domain', () => {
    expect([...node.subs.keys()]).toEqual(expect.arrayContaining([
      `notifications.${node.userUuid}`,
      `state.user.${node.userUuid}`,
    ]));
  });

  test('a legacy tab:new notification opens the tab', async () => {
    const opened = ctx.waitForEvent('page', { timeout: 15_000 });
    node.publish(`notifications.${node.userUuid}`,
      { action: 'tab:new', url: `${node.origin}/popped` });
    const tab = await opened;
    expect(tab.url()).toContain('/popped');
  });

  test('a current-shape ringing event lands in chrome.storage as call:ringing', async () => {
    node.publish(`notifications.${node.userUuid}`,
      { type: 'agent', message: { type: 'ringing', call: { uuid: 'ci-call-1' }, screen: { uuid: 'scr-1' } } });
    const stored = await sw.evaluate(() => new Promise<string | null>((resolve) => {
      const read = () => chrome.storage.local.get('call', (v: any) =>
        v && v.call ? resolve(v.call) : setTimeout(read, 200));
      read();
      setTimeout(() => resolve(null), 10_000);
    }));
    expect(stored, 'nothing reached chrome.storage.local["call"]').toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.event).toBe('call:ringing');
    expect(parsed.call.uuid).toBe('ci-call-1');
    expect(parsed.call.screen.uuid).toBe('scr-1');
  });
});
