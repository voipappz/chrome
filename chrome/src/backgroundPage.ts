import { CONFIG } from "../../angular/src/app/config"

// The app BFF's browser endpoint (/ws/events), not the cable server and not
// the broker.
//
// The BFF holds ONE ActionCable connection per browser client, authorized by
// that person's own login token, and derives which streams they get from that
// token's claims — so which user's events arrive is never something the client
// asks for. Talking to cable directly would mean sending our own user_uuid and
// being trusted on it; talking to NATS directly cannot be scoped per user at
// all. Same events either way: the BFF subscribes to cable, which is
// NATS-backed.
//
// The token travels as a SUBPROTOCOL, not a query parameter — browsers cannot
// set Authorization on a WebSocket handshake, and a URL is recorded by every
// reverse proxy and access log in between.
const BEARER_PREFIX = "voipappz-bearer.";

let ws: WebSocket | null = null;
let currentUuid = "";
let currentToken = "";
let realtimeUrl = "";
let reconnectTimer: any = null;

var TAB_ID = 0;
console.log('background script loaded');

chrome.runtime.onConnect.addListener(onConnect);
((chrome as any).action || chrome.browserAction).setTitle({ title: CONFIG.PAGE_TITLE })

function onConnect(port) {
    console.log("Connected .....");

    port.onMessage.addListener(function (msg) {
        console.log("message received", msg);
        if (msg.event == "logout") {
            disconnect();
        } else if (msg.event == "login") {
            if (msg.data && msg.data.user_uuid) {
                login(msg, port);
            }
        }
    });
}

async function login(msg: any, port: any) {
    const uuid = msg.data.user_uuid;
    const token = msg.data.token || "";
    if (ws && ws.readyState === WebSocket.OPEN && currentUuid === uuid) {
        return;
    }
    disconnect();

    const domain = (msg.domain || CONFIG.API_ENDPOINT).replace(/\/+$/, '');
    realtimeUrl = domain.replace(/^https?:\/\//, "wss://") + "/ws/events";
    currentUuid = uuid;
    currentToken = token;
    // Exposed on self so Playwright can verify the target before a connection
    // is even attempted.
    (self as any)._realtime_url = realtimeUrl;

    openSocket(port);
}

function openSocket(port?: any) {
    if (!currentUuid || !realtimeUrl) return;

    let sock: WebSocket;
    try {
        // base64url, unpadded — the server decodes it by mapping -/_ back and
        // re-padding, so + / = must not appear.
        const encoded = btoa(currentToken)
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        sock = new WebSocket(realtimeUrl, [BEARER_PREFIX + encoded]);
    } catch (err) {
        console.error("cable connect failed", realtimeUrl, err);
        scheduleReconnect();
        return;
    }
    ws = sock;
    (self as any)._realtime = sock;

    sock.onopen = () => {
        console.log("cable socket open", realtimeUrl);
    };

    sock.onmessage = (ev) => {
        let frame: any;
        try {
            frame = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch (e) {
            return;
        }
        if (!frame || !frame.type) return;

        // Every per-user stream is opened server-side from the token's claims,
        // so there is nothing to subscribe to and no uuid to send.
        switch (frame.type) {
            case "welcome":
                console.log("realtime connected", realtimeUrl, "cable_ready:", frame.cable_ready);
                try { port && port.postMessage("connected to realtime"); } catch (e) { /* popup closed */ }
                break;
            case "notification":
                // `message` is the Notifications payload verbatim — the same
                // shape this worker has always parsed.
                handleNotification(frame.message);
                break;
            case "user.state":
                // The BFF already folded the deltas into `view`; `message` is
                // the raw state document, which is what handleUserState stores.
                handleUserState(frame.message);
                break;
        }
    };

    sock.onclose = () => {
        if (ws === sock) { ws = null; scheduleReconnect(); }
    };
    sock.onerror = (err) => {
        console.error("cable socket error", err);
    };
}

// MV3 kills an idle service worker in ~30s. Incoming socket traffic resets that
// timer (Chrome 116+), and the cable server pings on its own schedule, so the
// connection is what keeps the worker alive — the same role nats.ws's
// pingInterval played.
function scheduleReconnect() {
    if (!currentUuid || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openSocket();
    }, 3000);
}

function disconnect() {
    currentUuid = "";
    currentToken = "";
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const sock = ws;
    ws = null;
    (self as any)._realtime = null;
    if (sock) {
        try { sock.close(); } catch (e) { /* already closed */ }
    }
}

function handleNotification(data: any) {
    console.log(data);

    // Legacy shape: { action: "tab:new" | "call:*", ... }
    if (data.action == "tab:new" && data.url) {
        openTab(data.url);
        return;
    }
    if (data.action == "call:answer" || data.action == "call:ringing" || data.action == "call:hangup") {
        setCall(data.action, data.call);
        return;
    }

    // Current API shape: { message: { type: "ringing"|"answer"|..., call, screen }, type: "agent" }
    const message = data.message;
    if (message && typeof message === "object" && message.type) {
        const call = { ...(message.call || {}), screen: message.screen };
        if (message.type == "ringing") {
            setCall("call:ringing", call);
        } else if (message.type == "answer") {
            setCall("call:answer", call);
        } else if (message.type == "hangup") {
            setCall("call:hangup", call);
        }
        return;
    }

    // Anything else (redirect / reminder / error / calls): keep the latest for
    // the popup to consume.
    chrome.storage.local.set({ 'notification': JSON.stringify(data) });
}

function setCall(event: string, call: any) {
    chrome.storage.local.set({ 'call': JSON.stringify({ event, call }) });
}

// Live agent state from va-crystal (state.user.<uuid>).
function handleUserState(op: any) {
    chrome.storage.local.set({ 'state': JSON.stringify(op) });
}

function openTab(url: string) {
    if (TAB_ID) {
        chrome.tabs.get(TAB_ID, () => {
            chrome.tabs.create({ url }, (tab) => { TAB_ID = tab.id; });
        });
    } else {
        chrome.tabs.create({ url }, (tab) => { TAB_ID = tab.id; });
    }
}
