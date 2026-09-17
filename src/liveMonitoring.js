import { WebSocket, WebSocketServer } from "ws";

const LIVE_MONITORING_PATH = "/api/live-monitoring";
const HEARTBEAT_INTERVAL = 30000;

function normalizeValue(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue || undefined;
}

function getAgentKey(clientKey, userId) {
  const normalizedClientKey = normalizeValue(clientKey);
  const normalizedUserId = normalizeValue(userId);

  return normalizedClientKey && normalizedUserId
    ? `${normalizedClientKey}:${normalizedUserId}`
    : undefined;
}

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    return false;
  }
}

export function isLiveMonitoringEnabled(environment = process.env) {
  return (
    environment.LIVE_MONITORING_ENABLED === "true" &&
    environment.NODE_ENV !== "production"
  );
}

export function attachLiveMonitoring(
  server,
  {
    allowedOrigins = [],
    environment = process.env,
    heartbeatInterval = HEARTBEAT_INTERVAL,
  } = {},
) {
  if (!isLiveMonitoringEnabled(environment)) {
    return undefined;
  }

  const agents = new Map();
  const connections = new Set();
  const dashboards = new Set();
  const allowedOriginSet = new Set(allowedOrigins);
  const webSocketServer = new WebSocketServer({ noServer: true });

  function hasSubscribers(agentKey) {
    return Array.from(dashboards).some((dashboard) =>
      dashboard.subscriptions.has(agentKey),
    );
  }

  function sendToAgent(agentKey, message) {
    agents.get(agentKey)?.forEach(({ socket }) => send(socket, message));
  }

  function stopDashboardSubscription(socket, agentKey) {
    if (!socket.subscriptions?.delete(agentKey)) {
      return;
    }

    if (!hasSubscribers(agentKey)) {
      sendToAgent(agentKey, { type: "STOP_LIVE" });
    }
  }

  function clearDashboardSubscriptions(socket, exceptAgentKey) {
    Array.from(socket.subscriptions || [])
      .filter((agentKey) => agentKey !== exceptAgentKey)
      .forEach((agentKey) => stopDashboardSubscription(socket, agentKey));
  }

  function createAgentsSnapshot(agentKey) {
    const tabs = agents.get(agentKey);

    if (!tabs?.size) {
      return { type: "AGENTS", agents: [] };
    }

    const tabEntries = Array.from(tabs.values()).sort((first, second) =>
      first.tabId.localeCompare(second.tabId),
    );
    const firstTab = tabEntries[0];

    return {
      type: "AGENTS",
      agents: [
        {
          clientKey: firstTab.clientKey,
          userId: firstTab.userId,
          ...(firstTab.agent ? { agent: firstTab.agent } : {}),
          ...(firstTab.designation
            ? { designation: firstTab.designation }
            : {}),
          ...(firstTab.host ? { host: firstTab.host } : {}),
          online: true,
          tabs: tabEntries.map(({ app, tabId }) => ({
            tabId,
            ...(app ? { app } : {}),
          })),
        },
      ],
    };
  }

  function broadcastAgents() {
    dashboards.forEach((dashboard) =>
      send(dashboard, createAgentsSnapshot(dashboard.agentFilter)),
    );
  }

  function unregisterAgent(socket, shouldBroadcast = true) {
    const registration = socket.agentRegistration;

    if (!registration) {
      return;
    }

    const tabs = agents.get(registration.agentKey);

    if (tabs?.get(registration.tabId)?.socket === socket) {
      tabs.delete(registration.tabId);

      if (tabs.size === 0) {
        agents.delete(registration.agentKey);
      }
    }

    socket.agentRegistration = undefined;

    if (shouldBroadcast) {
      broadcastAgents();
    }
  }

  function registerAgent(socket, message) {
    if (socket.role === "dashboard") {
      return;
    }

    const clientKey = normalizeValue(message.clientKey);
    const userId = normalizeValue(message.userId);
    const tabId = normalizeValue(message.tabId);
    const agentKey = getAgentKey(clientKey, userId);

    if (!agentKey || !tabId) {
      return;
    }

    unregisterAgent(socket, false);
    socket.role = "agent";
    socket.agentRegistration = { agentKey, tabId };

    const tabs = agents.get(agentKey) || new Map();
    const previousConnection = tabs.get(tabId)?.socket;

    if (previousConnection && previousConnection !== socket) {
      previousConnection.agentRegistration = undefined;
      previousConnection.close();
    }

    tabs.set(tabId, {
      socket,
      clientKey,
      userId,
      tabId,
      app: normalizeValue(message.app),
      agent: normalizeValue(message.agent),
      designation: normalizeValue(message.designation),
      host: normalizeValue(message.host),
    });
    agents.set(agentKey, tabs);

    if (hasSubscribers(agentKey)) {
      send(socket, { type: "START_LIVE" });
    }

    broadcastAgents();
  }

  function registerDashboard(socket, message) {
    if (socket.role && socket.role !== "dashboard") {
      return;
    }

    const agentFilter = getAgentKey(message.clientKey, message.userId);

    if (!agentFilter) {
      if (socket.role === "dashboard") {
        clearDashboardSubscriptions(socket);
        socket.agentFilter = undefined;
      }

      send(socket, { type: "AGENTS", agents: [] });
      return;
    }

    if (socket.role === "dashboard" && socket.agentFilter !== agentFilter) {
      clearDashboardSubscriptions(socket);
    }

    socket.role = "dashboard";
    socket.agentFilter = agentFilter;
    socket.subscriptions ||= new Set();
    dashboards.add(socket);
    send(socket, createAgentsSnapshot(agentFilter));
  }

  function handleDashboardCommand(socket, message) {
    if (socket.role !== "dashboard") {
      return;
    }

    const agentKey = getAgentKey(message.clientKey, message.userId);

    if (!agentKey || agentKey !== socket.agentFilter) {
      return;
    }

    if (message.type === "START_LIVE") {
      clearDashboardSubscriptions(socket, agentKey);
      socket.subscriptions.add(agentKey);
      sendToAgent(agentKey, { type: "START_LIVE" });
      return;
    }

    if (message.type === "STOP_LIVE") {
      stopDashboardSubscription(socket, agentKey);
    }
  }

  function routeLiveEvent(socket, message) {
    const agentKey = socket.agentRegistration?.agentKey;

    if (
      socket.role !== "agent" ||
      !agentKey ||
      !message.event ||
      typeof message.event !== "object" ||
      Array.isArray(message.event)
    ) {
      return;
    }

    dashboards.forEach((dashboard) => {
      if (
        dashboard.agentFilter === agentKey &&
        dashboard.subscriptions.has(agentKey)
      ) {
        send(dashboard, { type: "LIVE_EVENT", event: message.event });
      }
    });
  }

  function handleMessage(socket, data, isBinary) {
    if (isBinary) {
      return;
    }

    try {
      const message = JSON.parse(data.toString());

      if (!message || typeof message !== "object" || Array.isArray(message)) {
        return;
      }

      if (message.type === "AGENT_CONNECT") {
        registerAgent(socket, message);
      } else if (message.type === "AGENT_DISCONNECT") {
        unregisterAgent(socket);
      } else if (message.type === "DASHBOARD_CONNECT") {
        registerDashboard(socket, message);
      } else if (
        message.type === "START_LIVE" ||
        message.type === "STOP_LIVE"
      ) {
        handleDashboardCommand(socket, message);
      } else if (message.type === "LIVE_EVENT") {
        routeLiveEvent(socket, message);
      }
    } catch (error) {
      // Invalid messages are ignored without affecting other connections.
    }
  }

  function handleDashboardDisconnect(socket) {
    if (!dashboards.delete(socket)) {
      return;
    }

    clearDashboardSubscriptions(socket);
  }

  webSocketServer.on("connection", (socket) => {
    connections.add(socket);
    socket.isAlive = true;
    socket.subscriptions = new Set();

    socket.on("pong", () => {
      socket.isAlive = true;
    });
    socket.on("message", (data, isBinary) =>
      handleMessage(socket, data, isBinary),
    );
    socket.on("close", () => {
      connections.delete(socket);
      unregisterAgent(socket);
      handleDashboardDisconnect(socket);
    });
    socket.on("error", () => {});
  });

  function rejectUpgrade(socket, status, message) {
    try {
      socket.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
      );
    } catch (error) {
      socket.destroy();
    }
  }

  function handleUpgrade(request, socket, head) {
    let pathname;

    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch (error) {
      rejectUpgrade(socket, "400 Bad Request", "Invalid WebSocket URL");
      return;
    }

    if (pathname !== LIVE_MONITORING_PATH) {
      rejectUpgrade(socket, "404 Not Found", "WebSocket endpoint not found");
      return;
    }

    if (!allowedOriginSet.has(request.headers.origin)) {
      rejectUpgrade(socket, "403 Forbidden", "Origin is not allowed");
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  }

  server.on("upgrade", handleUpgrade);

  const heartbeat = setInterval(() => {
    connections.forEach((socket) => {
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }

      socket.isAlive = false;

      try {
        socket.ping();
      } catch (error) {
        socket.terminate();
      }
    });
  }, heartbeatInterval);

  heartbeat.unref?.();

  let closed = false;

  function close() {
    if (closed) {
      return;
    }

    closed = true;
    clearInterval(heartbeat);
    server.off("upgrade", handleUpgrade);
    server.off("close", close);
    connections.forEach((socket) => socket.terminate());
    webSocketServer.close();
  }

  server.on("close", close);

  return { close, webSocketServer };
}
