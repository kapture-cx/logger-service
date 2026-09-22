import { getTabId } from "./Identity.js";
import { showAgentInstruction } from "./AgentInstructions.js";

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

let app;
let enabled = false;
let getClientDetails;
let identityKey;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let reconnectTimer;
let socket;
let websocketEndPoint;

export function normalizeWebSocketEndPoint(value) {
  const endpoint =
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  if (!endpoint) {
    return undefined;
  }

  try {
    const url = new URL(endpoint, window.location.href);
    return url.protocol === "ws:" || url.protocol === "wss:"
      ? url.href
      : undefined;
  } catch (error) {
    return undefined;
  }
}

function normalizeIdentityValue(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue || undefined;
}

function getFreshClientDetails() {
  if (typeof getClientDetails !== "function") {
    return {};
  }

  try {
    const details = getClientDetails();
    return details && typeof details === "object" && !Array.isArray(details)
      ? details
      : {};
  } catch (error) {
    return {};
  }
}

function send(message) {
  if (!socket || socket.readyState !== 1) {
    return false;
  }

  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    return false;
  }
}

function createRegistration(details, clientKey, userId) {
  const registration = {
    type: "AGENT_CONNECT",
    clientKey,
    userId,
    tabId: getTabId(),
    app,
  };

  for (const field of ["agent", "designation", "host"]) {
    if (typeof details[field] === "string" && details[field].trim()) {
      registration[field] = details[field].trim();
    }
  }

  return registration;
}

function syncIdentity(forceRegistration = false) {
  const details = getFreshClientDetails();
  const clientKey = normalizeIdentityValue(details.clientKey);
  const userId = normalizeIdentityValue(details.userId);
  const nextIdentityKey = clientKey && userId ? `${clientKey}:${userId}` : undefined;

  if (identityKey !== nextIdentityKey) {
    enabled = false;

    if (identityKey) {
      send({ type: "AGENT_DISCONNECT" });
    }

    identityKey = nextIdentityKey;
    forceRegistration = true;
  }

  if (identityKey && forceRegistration) {
    send(createRegistration(details, clientKey, userId));
  }

  return details;
}

function scheduleReconnect() {
  if (reconnectTimer || !websocketEndPoint) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function handleMessage(event) {
  try {
    if (typeof event?.data !== "string") {
      return;
    }

    const message = JSON.parse(event.data);

    if (message?.type === "START_LIVE" && identityKey) {
      enabled = true;
    } else if (message?.type === "STOP_LIVE") {
      enabled = false;
    } else if (
      message?.type === "AGENT_INSTRUCTION" &&
      enabled &&
      identityKey
    ) {
      showAgentInstruction(message.instruction);
    }
  } catch (error) {
    // Malformed live-monitoring messages must not affect the host application.
  }
}

function connect() {
  if (!websocketEndPoint || typeof WebSocket !== "function") {
    return;
  }

  try {
    const nextSocket = new WebSocket(websocketEndPoint);
    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      if (socket !== nextSocket) {
        return;
      }

      reconnectDelay = INITIAL_RECONNECT_DELAY;
      syncIdentity(true);
    });

    nextSocket.addEventListener("message", handleMessage);
    nextSocket.addEventListener("error", () => {});
    nextSocket.addEventListener("close", () => {
      if (socket !== nextSocket) {
        return;
      }

      socket = undefined;
      enabled = false;
      scheduleReconnect();
    });
  } catch (error) {
    socket = undefined;
    enabled = false;
    scheduleReconnect();
  }
}

export function initializeLiveMonitor(config = {}) {
  websocketEndPoint = normalizeWebSocketEndPoint(config.websocketEndPoint);

  if (!websocketEndPoint) {
    return false;
  }

  app = config.app;
  getClientDetails = config.getClientDetails;
  connect();
  return true;
}

export function refreshLiveMonitorIdentity() {
  try {
    syncIdentity();
  } catch (error) {
    // Identity refresh failures must not affect the host application.
  }
}

export function sendLiveEvent(event) {
  try {
    const clientDetails = syncIdentity();

    if (!enabled || !identityKey) {
      return false;
    }

    return send({
      type: "LIVE_EVENT",
      event: {
        ...event,
        app,
        clientDetails,
      },
    });
  } catch (error) {
    return false;
  }
}
