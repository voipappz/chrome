import type { Page } from '@playwright/test';

/**
 * The next {event:"call"} frame the worker pushes for `callUuid`, read the way
 * the popup reads it: down a runtime port. The worker replays its last call to
 * every new port, so this may be armed before or after the event is published.
 * Resolves null after 10s.
 */
export const callFrameFor = (page: Page, callUuid: string) =>
  page.evaluate((wanted) => new Promise<any>((resolve) => {
    const port = chrome.runtime.connect({ name: 'e2e' });
    const timer = setTimeout(() => { port.disconnect(); resolve(null); }, 10_000);
    port.onMessage.addListener((msg: any) => {
      if (msg?.event === 'call' && msg.call?.uuid === wanted) {
        clearTimeout(timer);
        port.disconnect();
        resolve(msg);
      }
    });
  }), callUuid);
