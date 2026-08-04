import { test as base, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../../../angular/dist');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  popupPage: Page;
}>({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // headless:false + --headless=new: extensions only load in the "new"
      // headless mode, which Playwright's headless:true does not use.
      headless: false,
      args: [
        '--headless=new',
        '--no-sandbox',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
    await use(background.url().split('/')[2]);
  },

  popupPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    // navigate to /main — auth guard redirects to /login when not authenticated
    await page.goto(`chrome-extension://${extensionId}/index.html#/main`);
    await page.waitForURL(/login/);
    await use(page);
  },
});

export const expect = test.expect;
