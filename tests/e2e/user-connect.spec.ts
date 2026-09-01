import { test, expect } from './helpers/extension';

/**
 * A USER CONNECTS THE EXTENSION TO A NODE.
 *
 * login.spec.ts covers the popup's screens. This covers the thing underneath
 * them: that a user provisioned on a voipappz node can point this extension at
 * that node and end up holding a live session. It is the test `make
 * test-chrome` runs from the mothership against the node onboarding just built.
 *
 * The credential here is a USER (POST /auth/user_login), not the portal
 * Account — different table, different password. `make onboard` prints it as
 * "Extension login".
 */

const DOMAIN   = process.env.TEST_DOMAIN   ?? '';
const USERNAME = process.env.TEST_USERNAME ?? '';
const PASSWORD = process.env.TEST_PASSWORD ?? '';

const NEED_CREDS = 'set TEST_DOMAIN, TEST_USERNAME, and TEST_PASSWORD to run this test';

// Same normalisation the popup applies before it posts (login.component.ts).
const normalize = (raw: string) => {
  const d = (raw || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(d) ? d : 'https://' + d;
};

test.describe('User connect', () => {
  test.skip(!DOMAIN || !USERNAME || !PASSWORD, NEED_CREDS);

  /**
   * The extension has NO OTP branch: login.component.ts reads `data.token` and
   * `data.user.uuid` off the response and navigates. A node whose customer
   * profile carries login_otp_enabled=true answers step 1 with
   * `{ otp_sent: true, temp_token }` instead — no token, no user — and the
   * popup falls into its error handler and shows a snackbar with no message.
   *
   * That is a server-side policy, so no amount of UI poking diagnoses it.
   * Assert it directly, before spending a browser on it.
   */
  test('the node answers user_login with a session, not an OTP challenge', async ({ request }) => {
    const res = await request.post(`${normalize(DOMAIN)}/auth/user_login`, {
      form: { email: USERNAME, password: PASSWORD },
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json();
    expect(
      body.otp_sent,
      'this customer has login_otp_enabled — the extension cannot complete a 2-step login',
    ).toBeFalsy();
    expect(body.token, 'user_login returned no token').toBeTruthy();
    expect(body.user?.uuid, 'user_login returned no user uuid').toBeTruthy();
  });

  /**
   * The journey itself. "Connected" for this extension means three keys in the
   * popup's localStorage — the background worker is handed `_id` over the port
   * and reconnects from `_domain` on every later login, so a missing one is a
   * session that looks fine until the first notification never arrives.
   */
  test('a user logs in and the extension holds the session', async ({ popupPage }) => {
    await popupPage.locator('input[formcontrolname="domain"]').fill(DOMAIN);
    await popupPage.locator('input[formcontrolname="username"]').fill(USERNAME);
    await popupPage.locator('input[formcontrolname="password"]').fill(PASSWORD);
    await popupPage.getByRole('button', { name: /login/i }).click();

    await expect(popupPage).toHaveURL(/main/, { timeout: 15_000 });

    const session = await popupPage.evaluate(() => ({
      token:  localStorage.getItem('_token'),
      id:     localStorage.getItem('_id'),
      domain: localStorage.getItem('_domain'),
    }));
    expect(session.token).toBeTruthy();
    expect(session.id).toBeTruthy();
    expect(session.domain).toBe(normalize(DOMAIN));
  });

  /**
   * The node the user TYPED has to win over the one baked into the build.
   * config.ts still ships a hardcoded API_ENDPOINT (900.nimbusip.com) as the
   * background worker's fallback, so an extension that ignored the typed domain
   * would still log in — against someone else's node — and only reveal it by
   * subscribing to the wrong bus. `_nats_url` is set before connect() is
   * awaited, so this holds whether or not /nats is routed on this node yet.
   */
  test('the background worker targets wss://<typed domain>/nats', async ({ context, popupPage }) => {
    await popupPage.locator('input[formcontrolname="domain"]').fill(DOMAIN);
    await popupPage.locator('input[formcontrolname="username"]').fill(USERNAME);
    await popupPage.locator('input[formcontrolname="password"]').fill(PASSWORD);
    await popupPage.getByRole('button', { name: /login/i }).click();
    await expect(popupPage).toHaveURL(/main/, { timeout: 15_000 });

    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });

    const natsUrl: string | null = await sw.evaluate(() =>
      new Promise(resolve => {
        const read = () => (self as any)._nats_url as string | undefined;
        if (read()) { resolve(read()!); return; }
        const id = setInterval(() => { const v = read(); if (v) { clearInterval(id); resolve(v); } }, 200);
        setTimeout(() => { clearInterval(id); resolve(null); }, 10_000);
      })
    );

    expect(natsUrl, 'background worker never reached the NATS connect step').not.toBeNull();
    expect(natsUrl).toBe(normalize(DOMAIN).replace(/^https?:\/\//, 'wss://') + '/nats');
  });
});
