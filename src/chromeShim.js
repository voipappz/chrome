import { bearerProtocol, realtimeUrl } from './realtime.js';

/**
 * Lets the popup run as an ordinary web page (`make extension-dev`, then open
 * http://localhost:5175/index.html in any browser) instead of only inside the
 * packed extension. Iterating by rebuilding and clicking "reload" in
 * chrome://extensions is slow enough that people stop doing it.
 *
 * SELF-INSTALLING, AND ONLY WHEN ABSENT. Inside the extension `chrome.runtime`
 * always exists, so this does nothing there. There is no flag on purpose: a
 * shim gated on a flag is a shim that eventually ships enabled.
 *
 * WHAT IS FAITHFUL AND WHAT IS NOT:
 *   tabs.create      window.open.
 *   runtime.connect  a port that opens the REAL /ws/events socket, so this mode
 *                    exercises the same realtime hop as the worker, and pushes
 *                    {event:"realtime"} on the welcome frame so the light works.
 *                    Frames go to the console. Screen pops do NOT open tabs
 *                    here: that is the worker's job, and it does not run.
 */
function fakePort() {
  let socket = null;
  const listeners = [];
  let state = { connected: false, cable_ready: false };

  const emit = (msg) => listeners.forEach((fn) => fn(msg));
  const setState = (connected, cable_ready = false) => {
    state = { connected, cable_ready: connected && cable_ready };
    emit({ event: 'realtime', ...state });
  };
  const close = () => {
    try { socket?.close(); } catch { /* already gone */ }
    socket = null;
    setState(false);
  };

  return {
    name: 'shim',
    onMessage: {
      addListener: (fn) => { listeners.push(fn); fn({ event: 'realtime', ...state }); },
      removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    },
    onDisconnect: { addListener: () => undefined, removeListener: () => undefined },
    disconnect: close,
    postMessage(msg) {
      if (msg?.event === 'status') return emit({ event: 'realtime', ...state });
      if (msg?.event === 'logout') return close();
      if (msg?.event !== 'login') return;

      const token = msg?.data?.token || localStorage.getItem('_token') || '';
      const domain = msg?.domain || localStorage.getItem('_domain') || '';
      if (!token || !domain) {
        console.warn('[chrome-shim] no session yet, sign in to open /ws/events');
        return;
      }

      close();
      const url = realtimeUrl(domain);
      console.log('[chrome-shim] realtime →', url);
      socket = new WebSocket(url, [bearerProtocol(token)]);
      socket.onmessage = (ev) => {
        console.log('[chrome-shim] frame', ev.data);
        try {
          const frame = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
          if (frame?.type === 'welcome') setState(true, !!frame.cable_ready);
        } catch { /* not a frame we judge on */ }
      };
      socket.onclose = (ev) => {
        console.log('[chrome-shim] realtime closed', ev.code);
        setState(false);
      };
    },
  };
}

if (!globalThis.chrome?.runtime?.connect) {
  console.info('[chrome-shim] no extension APIs, running the popup as a plain page');
  globalThis.chrome = {
    tabs: { create: ({ url }) => window.open(url, '_blank') },
    runtime: {
      connect: fakePort,
      // The build stamp reads this; without it the stamp renders "v" and
      // nothing else, which reads as broken rather than as "no manifest here".
      getManifest: () => ({ version: '0.0.0-dev' }),
    },
  };
}
