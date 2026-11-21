import { test, expect } from '@playwright/test';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { startFakeNode, type FakeNode } from './helpers/fake-node';
import { callFrameFor } from './helpers/worker';

/**
 * The RECEIVE path against a mimicked node (helpers/fake-node.ts) — no real
 * node, broker, credential or secret, so unlike user-connect.spec.ts this
 * runs everywhere, including hosted CI.
 *
 * Own fixture rather than helpers/extension.ts because the realtime leg is
 * wss:// to a self-signed cert, which needs --ignore-certificate-errors.
 */
const EXT = path.resolve(import.meta.dirname, '../../dist');



test.describe('Realtime against a mimicked node', () => {
  let node: FakeNode;
  let ctx: BrowserContext;
  let sw: Worker;
  let page: Page;
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

    page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/index.html#/main`);
    await page.waitForURL(/login/);
    await page.evaluate((d) => localStorage.setItem('_domain', d), node.origin);
    await page.locator('input[name="username"]').fill('ci@fake.local');
    await page.locator('input[name="password"]').fill('anything');
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page).toHaveURL(/main/, { timeout: 20_000 });

    // Live means the socket authenticated and the server welcomed it.
    await expect
      .poll(() => node.offeredProtocols.some((p) => p.startsWith('voipappz-bearer.')),
            { timeout: 20_000 })
      .toBe(true);
  });

  test.afterAll(async () => {
    await ctx?.close();
    await node?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // The token must travel out of band. A regression to ?token= would still
  // connect, and would still work — while writing the credential into every
  // proxy and access log on the way.
  test('the worker authenticates with a bearer subprotocol, not the URL', () => {
    const bearer = node.offeredProtocols.find((p) => p.startsWith('voipappz-bearer.'));
    expect(bearer, 'no voipappz-bearer.* subprotocol was offered').toBeTruthy();
    expect(bearer!.length).toBeGreaterThan('voipappz-bearer.'.length);
  });

  test('a tab:new notification opens the tab', async () => {
    const opened = ctx.waitForEvent('page', { timeout: 15_000 });
    node.publish({ type: 'notification',
      message: { action: 'tab:new', url: `${node.origin}/popped` } });
    const tab = await opened;
    expect(tab.url()).toContain('/popped');
  });

  test('a current-shape ringing event reaches the popup as call:ringing', async () => {
    node.publish({ type: 'notification',
      message: { type: 'agent', message: { type: 'ringing', call: { uuid: 'ci-call-1' }, screen: { uuid: 'scr-1' } } } });
    const frame = await callFrameFor(page, 'ci-call-1');
    expect(frame, 'the worker pushed no call frame down the port').toBeTruthy();
    expect(frame.status).toBe('call:ringing');
    expect(frame.call.screen.uuid).toBe('scr-1');
    // And React drew it: the port assertion alone passes even if the popup's
    // own listener stopped delivering calls.
    const card = page.getByTestId('call-card');
    await expect(card).toContainText('ci-call-1');
    await expect(card).toContainText('ringing');
  });
});
