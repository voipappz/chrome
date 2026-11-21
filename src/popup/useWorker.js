import { useEffect, useRef, useState } from 'react';

/**
 * The popup's line to the service worker. Everything the popup shows about the
 * socket and the call comes down this port, and nothing is stored: the worker
 * holds both in memory and pushes them on connect, so a popup opened minutes
 * later is told the truth rather than reading a cached "connected" for a
 * socket that died with the worker.
 */
export function useWorker({ onCall } = {}) {
  const [realtime, setRealtime] = useState({ connected: false, cable_ready: false });
  const portRef = useRef(null);
  const onCallRef = useRef(onCall);
  onCallRef.current = onCall;

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'main' });
    portRef.current = port;
    const listener = (msg) => {
      if (!msg?.event) return;
      if (msg.event === 'realtime') setRealtime({ connected: !!msg.connected, cable_ready: !!msg.cable_ready });
      else if (msg.event === 'call') onCallRef.current?.(msg);
    };
    port.onMessage.addListener(listener);
    port.postMessage({ event: 'status' });
    return () => {
      port.onMessage.removeListener(listener);
      try { port.disconnect(); } catch { /* already gone */ }
      portRef.current = null;
    };
  }, []);

  const post = (msg) => portRef.current?.postMessage(msg);
  return { realtime, post };
}

/** A one-off message to the worker, from a page that does not hold a port. */
export function tellWorker(msg) {
  const port = chrome.runtime.connect();
  port.postMessage(msg);
}
