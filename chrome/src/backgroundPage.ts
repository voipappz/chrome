import { CONFIG } from "../../angular/src/app/config"

// ActionCable over WSS, not a broker connection. The cable server (the
// va-crystal node, /cable) authenticates the SAME token the popup already
// holds — HS256, `user_uuid`, signed with the node's SECRET_KEY — so a browser
// gets per-user authorization with no second credential. Talking to NATS
// directly cannot do that: subject permissions are static, so a shipped client
// would need `notifications.>` and a shared password, which reads every
// tenant's calls. Cable is NATS-backed anyway (Cable::NATSBackend), so the
// events are identical; only the browser's hop changes.
const CABLE_PROTOCOL = "actioncable-v1-json";

let ws: WebSocket | null = null;
let currentUuid = "";
let currentToken = "";
let cableUrl = "";
let reconnectTimer: any = null;
let identifiers: { notifications: string; state: string } | null = null;

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

// An ActionCable subscription is keyed by the EXACT JSON string of its
// identifier — the server echoes it back verbatim, so the client must match on
// the same string it sent. Key order is part of the identity.
function ids(uuid: string) {
    return {
        notifications: JSON.stringify({ channel: "Notifications", user_uuid: uuid }),
        state: JSON.stringify({ channel: "StateChannel", scope: "user", id: uuid }),
    };
}

async function login(msg: any, port: any) {
    const uuid = msg.data.user_uuid;
    const token = msg.data.token || "";
    if (ws && ws.readyState === WebSocket.OPEN && currentUuid === uuid) {
        return;
    }
    disconnect();

    const domain = (msg.domain || CONFIG.API_ENDPOINT).replace(/\/+$/, '');
    cableUrl = domain.replace(/^https?:\/\//, "wss://") + "/cable";
    currentUuid = uuid;
    currentToken = token;
    identifiers = ids(uuid);
    // Exposed on self so Playwright can verify the target before a connection
    // is even attempted.
    (self as any)._cable_url = cableUrl;

    openSocket(port);
}

function openSocket(port?: any) {
    if (!currentUuid || !cableUrl) return;

    const url = cableUrl + "?token=" + encodeURIComponent(currentToken);
    let sock: WebSocket;
    try {
        // The subprotocol is REQUIRED: the server advertises
        // actioncable-v1-json, and a client that does not request it fails the
        // handshake outright.
        sock = new WebSocket(url, [CABLE_PROTOCOL]);
    } catch (err) {
        console.error("cable connect failed", cableUrl, err);
        scheduleReconnect();
        return;
    }
    ws = sock;
    (self as any)._cable = sock;

    sock.onopen = () => {
        console.log("cable socket open", cableUrl);
    };

    sock.onmessage = (ev) => {
        let frame: any;
        try {
            frame = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch (e) {
            return;
        }
        if (!frame) return;

        // Dispatch rule from the protocol: a frame carrying `type` is protocol
        // traffic (welcome / ping / confirm / reject / disconnect). Anything
        // else is data, routed by its identifier.
        if (frame.type) {
            if (frame.type === "welcome") {
                subscribe(sock);
                try { port && port.postMessage("connected to cable"); } catch (e) { /* popup closed */ }
            } else if (frame.type === "disconnect") {
                console.warn("cable disconnected by server", frame);
            } else if (frame.type === "reject_subscription") {
                console.error("cable rejected subscription", frame.identifier);
            }
            // ping frames carry no identifier and need no reply
            return;
        }

        if (!identifiers) return;
        if (frame.identifier === identifiers.notifications) {
            handleNotification(frame.message);
        } else if (frame.identifier === identifiers.state) {
            handleUserState(frame.message);
        }
    };

    sock.onclose = () => {
        if (ws === sock) { ws = null; scheduleReconnect(); }
    };
    sock.onerror = (err) => {
        console.error("cable socket error", err);
    };
}

function subscribe(sock: WebSocket) {
    if (!identifiers) return;
    // Registration is asynchronous and unbuffered: anything published between
    // `subscribe` and the server registering the stream is simply not
    // delivered. Nothing here depends on that window, but it is why a test
    // must wait for confirm_subscription before publishing.
    sock.send(JSON.stringify({ command: "subscribe", identifier: identifiers.notifications }));
    sock.send(JSON.stringify({ command: "subscribe", identifier: identifiers.state }));
    console.log("subscribed to Notifications + StateChannel for", currentUuid);
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
    identifiers = null;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const sock = ws;
    ws = null;
    (self as any)._cable = null;
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
