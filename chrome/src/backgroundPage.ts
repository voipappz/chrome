import { CONFIG } from "../../angular/src/app/config"
import { connect, NatsConnection, StringCodec } from "nats.ws";

const sc = StringCodec();
let nc: NatsConnection | null = null;
let currentUuid = "";

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
    if (nc && !nc.isClosed() && currentUuid === uuid) {
        return;
    }
    await disconnect();

    const domain = (msg.domain || CONFIG.API_ENDPOINT).replace(/\/+$/, '');
    const wsUrl = domain.replace(/^https?:\/\//, "wss://") + "/nats";
    try {
        nc = await connect({
            servers: wsUrl,
            // Not a secret — selects the subscribe-only NATS user; the
            // permission set on the server is the security boundary.
            user: "extension",
            pass: "extension",
            maxReconnectAttempts: -1,
            // Frequent pings keep the MV3 service worker alive: incoming
            // websocket traffic resets Chrome's idle timer (Chrome 116+).
            pingInterval: 20000,
        });
    } catch (err) {
        console.error("nats connect failed", wsUrl, err);
        return;
    }
    currentUuid = uuid;
    // Expose on self so Playwright can verify connection state
    (self as any)._nats = nc;
    (self as any)._nats_url = wsUrl;
    try { port.postMessage("connected to nats"); } catch (e) { /* popup closed */ }

    subscribeService("notifications", uuid, handleNotification);
    subscribeService("state.user", uuid, handleUserState);
}

async function disconnect() {
    currentUuid = "";
    if (nc) {
        const conn = nc;
        nc = null;
        try { await conn.close(); } catch (e) { /* already closed */ }
    }
}

// Subscribe to one service.<uuid> subject and hand each JSON message to the
// handler. Mirrors the server side: Mediators::Broadcast::Nats.publish and
// va-crystal's state.<scope>.<id> streams.
function subscribeService(service: string, uuid: string, handler: (data: any) => void) {
    if (!nc) return;
    const subject = service + "." + uuid;
    nc.subscribe(subject, {
        callback: (err, m) => {
            if (err) {
                console.error("subscription error", subject, err);
                return;
            }
            let data: any;
            try {
                data = JSON.parse(sc.decode(m.data));
            } catch (e) {
                console.warn("non-JSON message on", subject);
                return;
            }
            handler(data);
        }
    });
    console.log("subscribed to", subject);
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
