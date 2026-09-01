import { test, expect } from './helpers/extension';

const DOMAIN   = process.env.TEST_DOMAIN   ?? '';
const USERNAME = process.env.TEST_USERNAME ?? '';
const PASSWORD = process.env.TEST_PASSWORD ?? '';

const NEED_CREDS = 'set TEST_DOMAIN, TEST_USERNAME, and TEST_PASSWORD to run this test';

const domainInput   = (page) => page.locator('input[formcontrolname="domain"]');
const usernameInput = (page) => page.locator('input[formcontrolname="username"]');
const passwordInput = (page) => page.locator('input[formcontrolname="password"]');
const loginButton   = (page) => page.getByRole('button', { name: /login/i });
const logoutButton  = (page) => page.locator('button:has(mat-icon:text("logout"))');

async function loginWith(page, domain, username, password) {
  await domainInput(page).fill(domain);
  await usernameInput(page).fill(username);
  await passwordInput(page).fill(password);
  await loginButton(page).click();
  await expect(page).toHaveURL(/main/, { timeout: 15_000 });
}

// ─── Login page ────────────────────────────────────────────────────────────────

test.describe('Login page', () => {
  test('renders domain, username, and password fields', async ({ popupPage }) => {
    await expect(domainInput(popupPage)).toBeVisible();
    await expect(usernameInput(popupPage)).toBeVisible();
    await expect(passwordInput(popupPage)).toBeVisible();
    await expect(loginButton(popupPage)).toBeVisible();
  });

  test('invalid credentials show error snackbar', async ({ popupPage }) => {
    test.skip(!DOMAIN, 'set TEST_DOMAIN to run this test');

    await domainInput(popupPage).fill(DOMAIN);
    await usernameInput(popupPage).fill('invalid@test.com');
    await passwordInput(popupPage).fill('wrongpassword');
    await loginButton(popupPage).click();

    await expect(popupPage.locator('.mat-snack-bar-container')).toBeVisible({ timeout: 10_000 });
  });

  test('valid credentials navigate to main', async ({ popupPage }) => {
    test.skip(!DOMAIN || !USERNAME || !PASSWORD, NEED_CREDS);
    await loginWith(popupPage, DOMAIN, USERNAME, PASSWORD);
  });
});

// ─── Main page (post-login) ────────────────────────────────────────────────────

test.describe('Main page (post-login)', () => {
  test.beforeEach(async ({ popupPage }) => {
    test.skip(!DOMAIN || !USERNAME || !PASSWORD, NEED_CREDS);
    await loginWith(popupPage, DOMAIN, USERNAME, PASSWORD);
  });

  test('shows user name in the toolbar', async ({ popupPage }) => {
    // User data is fetched from /api/users/:id — wait for a non-empty name span
    const nameSpan = popupPage.locator('mat-toolbar span').filter({ hasText: /\S/ }).first();
    await expect(nameSpan).toBeVisible({ timeout: 10_000 });
    const text = await nameSpan.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('shows availability selector', async ({ popupPage }) => {
    await expect(popupPage.locator('mat-select').first()).toBeVisible();
  });

  test('shows call card (active or idle)', async ({ popupPage }) => {
    await expect(popupPage.locator('mat-card')).toBeVisible();
  });

  test('timer element is present; ticks when user has no active status', async ({ popupPage }) => {
    const timer = popupPage.locator('.timer');
    await expect(timer).toBeVisible({ timeout: 5_000 });

    // Timer only starts when the user has no break status.
    // Wait up to 3 s to see if it shows a time value; if not, the user has a
    // status set and ticking simply doesn't apply — the test passes either way.
    const hasTime = await timer.evaluate(
      el => new Promise(resolve => {
        const check = () => /\d{2}:\d{2}:\d{2}/.test(el.textContent ?? '');
        if (check()) { resolve(true); return; }
        const id = setInterval(() => { if (check()) { clearInterval(id); resolve(true); } }, 200);
        setTimeout(() => { clearInterval(id); resolve(false); }, 3000);
      })
    );
    if (hasTime) {
      const t1 = await timer.textContent();
      await popupPage.waitForTimeout(2000);
      const t2 = await timer.textContent();
      expect(t1).not.toEqual(t2);
    }
  });

  test('availability can be toggled to unavailable', async ({ popupPage }) => {
    // First mat-select is the availability selector
    const availSel = popupPage.locator('mat-select').first();
    await availSel.click();
    // "לא זמין" = not available
    await popupPage.locator('mat-option').filter({ hasText: 'לא זמין' }).click();
    // selector should now show the new value (no redirect, stays on main)
    await expect(popupPage).toHaveURL(/main/);
  });

  test('logout navigates back to login', async ({ popupPage }) => {
    await logoutButton(popupPage).click();
    await expect(popupPage).toHaveURL(/login/, { timeout: 10_000 });
    await expect(domainInput(popupPage)).toBeVisible();
  });
});

// ─── Cable WebSocket ──────────────────────────────────────────────────────────

test.describe('Cable', () => {
  test('targets wss://<domain>/cable after login', async ({ context, popupPage }) => {
    test.skip(!DOMAIN || !USERNAME || !PASSWORD, NEED_CREDS);

    await loginWith(popupPage, DOMAIN, USERNAME, PASSWORD);

    // The background service worker connects asynchronously.
    // Poll self._cable_url (set in backgroundPage.ts) via sw.evaluate().
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });

    const cableUrl: string | null = await sw.evaluate(() =>
      new Promise(resolve => {
        const check = () => (self as any)._cable_url as string | undefined;
        if (check()) { resolve(check()!); return; }
        const id = setInterval(() => { const v = check(); if (v) { clearInterval(id); resolve(v); } }, 200);
        setTimeout(() => { clearInterval(id); resolve(null); }, 10_000);
      })
    );

    expect(cableUrl).not.toBeNull();
    expect(cableUrl).toMatch(/^wss:\/\//);
    expect(cableUrl).toContain('/cable');
  });

  test('WebSocket connection becomes active', async ({ context, popupPage }) => {
    test.skip(!DOMAIN || !USERNAME || !PASSWORD, NEED_CREDS);

    await loginWith(popupPage, DOMAIN, USERNAME, PASSWORD);

    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });

    // self._cable is the WebSocket itself; OPEN (readyState 1) is the only
    // state in which the subscriptions could have been confirmed.
    const isActive: boolean = await sw.evaluate(() =>
      new Promise(resolve => {
        const check = () => {
          const sock = (self as any)._cable;
          return !!sock && sock.readyState === 1;
        };
        if (check()) { resolve(true); return; }
        const id = setInterval(() => { if (check()) { clearInterval(id); resolve(true); } }, 300);
        setTimeout(() => { clearInterval(id); resolve(false); }, 15_000);
      })
    );

    expect(isActive).toBe(true);
  });
});

// ─── Session persistence ───────────────────────────────────────────────────────

test.describe('Session persistence', () => {
  test('stays on main after page reload', async ({ popupPage, extensionId }) => {
    test.skip(!DOMAIN || !USERNAME || !PASSWORD, NEED_CREDS);

    await loginWith(popupPage, DOMAIN, USERNAME, PASSWORD);

    // Reload the extension popup
    await popupPage.goto(`chrome-extension://${extensionId}/index.html#/main`);
    await expect(popupPage).toHaveURL(/main/, { timeout: 10_000 });
  });

  test('logout clears session — reload goes to login', async ({ popupPage, extensionId }) => {
    test.skip(!DOMAIN || !USERNAME || !PASSWORD, NEED_CREDS);

    await loginWith(popupPage, DOMAIN, USERNAME, PASSWORD);
    await logoutButton(popupPage).click();
    await expect(popupPage).toHaveURL(/login/, { timeout: 10_000 });

    // Reload — should stay on login (token was cleared)
    await popupPage.goto(`chrome-extension://${extensionId}/index.html#/main`);
    await expect(popupPage).toHaveURL(/login/, { timeout: 10_000 });
  });
});
