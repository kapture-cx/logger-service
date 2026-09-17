import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";
import { WebSocket } from "ws";
import {
  attachLiveMonitoring,
  isLiveMonitoringEnabled,
} from "../src/liveMonitoring.js";

const resources = [];

afterEach(async () => {
  while (resources.length) {
    const { liveMonitoring, server } = resources.pop();
    liveMonitoring?.close();

    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

async function startLiveServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const liveMonitoring = attachLiveMonitoring(server, {
    allowedOrigins: ["http://localhost:3000"],
    environment: {
      LIVE_MONITORING_ENABLED: "true",
      NODE_ENV: "development",
    },
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });

  resources.push({ liveMonitoring, server });

  return `ws://127.0.0.1:${server.address().port}/api/live-monitoring`;
}

async function connect(url, origin = "http://localhost:3000") {
  const socket = new WebSocket(url, { origin });
  const messages = [];
  const waiters = [];

  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const waiterIndex = waiters.findIndex(({ predicate }) => predicate(message));

    if (waiterIndex >= 0) {
      const [{ resolve }] = waiters.splice(waiterIndex, 1);
      resolve(message);
    } else {
      messages.push(message);
    }
  });

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return {
    socket,
    getMessages() {
      return [...messages];
    },
    next(predicate = () => true) {
      const messageIndex = messages.findIndex(predicate);

      if (messageIndex >= 0) {
        return Promise.resolve(messages.splice(messageIndex, 1)[0]);
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const waiterIndex = waiters.findIndex(
            (waiter) => waiter.resolve === resolve,
          );
          waiters.splice(waiterIndex, 1);
          reject(new Error("Timed out waiting for WebSocket message"));
        }, 2000);

        waiters.push({
          predicate,
          resolve(message) {
            clearTimeout(timeout);
            resolve(message);
          },
        });
      });
    },
    send(message) {
      socket.send(JSON.stringify(message));
    },
  };
}

test("live monitoring requires its flag and is always off in production", () => {
  assert.equal(isLiveMonitoringEnabled({}), false);
  assert.equal(
    isLiveMonitoringEnabled({
      LIVE_MONITORING_ENABLED: "true",
      NODE_ENV: "production",
    }),
    false,
  );
  assert.equal(
    isLiveMonitoringEnabled({
      LIVE_MONITORING_ENABLED: "true",
      NODE_ENV: "development",
    }),
    true,
  );
});

test("the backend reports multi-tab presence and routes subscribed events", async () => {
  const url = await startLiveServer();
  const dashboard = await connect(url);
  dashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "democrm",
    userId: 120040,
  });
  assert.deepEqual(await dashboard.next(), { type: "AGENTS", agents: [] });

  const firstAgent = await connect(url);
  firstAgent.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: 120040,
    tabId: "tab-a",
    app: "kapturecrm-ui",
    agent: "Ankit Tiwari",
  });

  const secondAgent = await connect(url);
  secondAgent.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: "120040",
    tabId: "tab-b",
    app: "kapturecrm-ui",
    agent: "Ankit Tiwari",
  });

  const presence = await dashboard.next(
    (message) => message.type === "AGENTS" && message.agents[0]?.tabs.length === 2,
  );
  assert.deepEqual(
    presence.agents[0].tabs.map(({ tabId }) => tabId),
    ["tab-a", "tab-b"],
  );

  dashboard.send({
    type: "START_LIVE",
    clientKey: "democrm",
    userId: 120040,
  });
  assert.deepEqual(await firstAgent.next(), { type: "START_LIVE" });
  assert.deepEqual(await secondAgent.next(), { type: "START_LIVE" });

  firstAgent.send({
    type: "LIVE_EVENT",
    event: { type: "console", tabId: "tab-a", message: "Live message" },
  });
  assert.deepEqual(await dashboard.next((message) => message.type === "LIVE_EVENT"), {
    type: "LIVE_EVENT",
    event: { type: "console", tabId: "tab-a", message: "Live message" },
  });

  const thirdAgent = await connect(url);
  thirdAgent.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: 120040,
    tabId: "tab-c",
  });
  assert.deepEqual(await thirdAgent.next(), { type: "START_LIVE" });

  dashboard.send({
    type: "STOP_LIVE",
    clientKey: "democrm",
    userId: "120040",
  });
  assert.deepEqual(await firstAgent.next(), { type: "STOP_LIVE" });
  assert.deepEqual(await secondAgent.next(), { type: "STOP_LIVE" });
  assert.deepEqual(await thirdAgent.next(), { type: "STOP_LIVE" });
});

test("one dashboard cannot stop another dashboard's subscription", async () => {
  const url = await startLiveServer();
  const firstDashboard = await connect(url);
  const secondDashboard = await connect(url);
  const agent = await connect(url);
  firstDashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "democrm",
    userId: 1,
  });
  secondDashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "democrm",
    userId: 1,
  });
  await firstDashboard.next();
  await secondDashboard.next();
  agent.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: 1,
    tabId: "tab-a",
  });

  firstDashboard.send({ type: "START_LIVE", clientKey: "democrm", userId: 1 });
  await agent.next((message) => message.type === "START_LIVE");
  secondDashboard.send({ type: "START_LIVE", clientKey: "democrm", userId: 1 });
  await agent.next((message) => message.type === "START_LIVE");
  firstDashboard.send({ type: "STOP_LIVE", clientKey: "democrm", userId: 1 });

  agent.send({ type: "LIVE_EVENT", event: { type: "console" } });
  assert.equal(
    (await secondDashboard.next((message) => message.type === "LIVE_EVENT")).type,
    "LIVE_EVENT",
  );

  secondDashboard.socket.close();
  assert.deepEqual(await agent.next(), { type: "STOP_LIVE" });
});

test("the backend rejects unlisted origins and ignores malformed messages", async () => {
  const url = await startLiveServer();

  await assert.rejects(
    connect(url, "https://unlisted.example.com"),
    /Unexpected server response: 403/,
  );

  const dashboard = await connect(url);
  dashboard.socket.send("not-json");
  dashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "democrm",
    userId: 1,
  });
  assert.deepEqual(await dashboard.next(), { type: "AGENTS", agents: [] });
});

test("each dashboard receives only its selected agent presence", async () => {
  const url = await startLiveServer();
  const dashboard = await connect(url);
  dashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "democrm",
    userId: "120040",
  });
  assert.deepEqual(await dashboard.next(), { type: "AGENTS", agents: [] });

  const firstAgent = await connect(url);
  const secondAgent = await connect(url);

  firstAgent.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: 120040,
    tabId: "tab-a",
    agent: "Ankit Tiwari",
  });
  const firstPresence = await dashboard.next(
    (message) => message.agents[0]?.clientKey === "democrm",
  );
  assert.equal(firstPresence.agents.length, 1);
  assert.equal(firstPresence.agents[0].clientKey, "democrm");
  assert.equal(firstPresence.agents[0].userId, "120040");

  secondAgent.send({
    type: "AGENT_CONNECT",
    clientKey: "anothercrm",
    userId: 550,
    tabId: "tab-x",
    agent: "Rahul Sharma",
  });

  dashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "anothercrm",
    userId: 550,
  });

  const secondPresence = await dashboard.next(
    (message) => message.agents[0]?.clientKey === "anothercrm",
  );
  assert.equal(secondPresence.agents.length, 1);
  assert.equal(secondPresence.agents[0].clientKey, "anothercrm");
  assert.equal(secondPresence.agents[0].userId, "550");

  dashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "missing-client",
    userId: "missing-user",
  });
  assert.deepEqual(
    await dashboard.next((message) => message.agents.length === 0),
    { type: "AGENTS", agents: [] },
  );

  dashboard.send({ type: "DASHBOARD_CONNECT" });
  assert.deepEqual(
    await dashboard.next((message) => message.agents.length === 0),
    { type: "AGENTS", agents: [] },
  );
});

test("presence broadcasts stay filtered and preserve all matching tabs", async () => {
  const url = await startLiveServer();
  const firstDashboard = await connect(url);
  const secondDashboard = await connect(url);

  firstDashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "democrm",
    userId: 120040,
  });
  secondDashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "anothercrm",
    userId: 550,
  });
  await firstDashboard.next();
  await secondDashboard.next();

  const firstTab = await connect(url);
  firstTab.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: 120040,
    tabId: "tab-a",
  });
  const firstDashboardPresence = await firstDashboard.next(
    (message) => message.agents[0]?.tabs.length === 1,
  );
  const secondDashboardPresence = await secondDashboard.next();
  assert.equal(firstDashboardPresence.agents[0].clientKey, "democrm");
  assert.deepEqual(secondDashboardPresence.agents, []);

  const secondTab = await connect(url);
  secondTab.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: "120040",
    tabId: "tab-b",
  });
  const multiTabPresence = await firstDashboard.next(
    (message) => message.agents[0]?.tabs.length === 2,
  );
  assert.deepEqual(
    multiTabPresence.agents[0].tabs.map(({ tabId }) => tabId),
    ["tab-a", "tab-b"],
  );

  const otherAgent = await connect(url);
  otherAgent.send({
    type: "AGENT_CONNECT",
    clientKey: "anothercrm",
    userId: 550,
    tabId: "tab-x",
  });
  const otherPresence = await secondDashboard.next(
    (message) => message.agents[0]?.clientKey === "anothercrm",
  );
  assert.equal(otherPresence.agents.length, 1);
  assert.equal(otherPresence.agents[0].userId, "550");

  const stillFilteredPresence = await firstDashboard.next(
    (message) => message.agents[0]?.tabs.length === 2,
  );
  assert.equal(stillFilteredPresence.agents[0].clientKey, "democrm");

  secondTab.socket.close();
  const disconnectedTabPresence = await firstDashboard.next(
    (message) => message.agents[0]?.tabs.length === 1,
  );
  assert.deepEqual(disconnectedTabPresence.agents[0].tabs, [
    { tabId: "tab-a" },
  ]);
});

test("live events are restricted to the dashboard's selected identity", async () => {
  const url = await startLiveServer();
  const dashboard = await connect(url);
  const firstTab = await connect(url);
  const secondTab = await connect(url);
  const otherAgent = await connect(url);

  dashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "democrm",
    userId: 120040,
  });
  await dashboard.next();

  firstTab.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: 120040,
    tabId: "tab-a",
  });
  secondTab.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: "120040",
    tabId: "tab-b",
  });
  otherAgent.send({
    type: "AGENT_CONNECT",
    clientKey: "anothercrm",
    userId: 550,
    tabId: "tab-x",
  });
  await dashboard.next(
    (message) => message.agents[0]?.tabs.length === 2,
  );

  dashboard.send({
    type: "START_LIVE",
    clientKey: "anothercrm",
    userId: 550,
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    otherAgent.getMessages().some((message) => message.type === "START_LIVE"),
    false,
  );

  dashboard.send({
    type: "START_LIVE",
    clientKey: "democrm",
    userId: 120040,
  });
  await firstTab.next((message) => message.type === "START_LIVE");
  await secondTab.next((message) => message.type === "START_LIVE");

  otherAgent.send({
    type: "LIVE_EVENT",
    event: {
      type: "console",
      message: "Must stay private",
      clientDetails: { clientKey: "anothercrm", userId: 550 },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    dashboard
      .getMessages()
      .some((message) => message.event?.message === "Must stay private"),
    false,
  );

  firstTab.send({
    type: "LIVE_EVENT",
    event: {
      type: "console",
      tabId: "tab-a",
      message: "First matching tab",
      clientDetails: { clientKey: "democrm", userId: 120040 },
    },
  });
  secondTab.send({
    type: "LIVE_EVENT",
    event: {
      type: "console",
      tabId: "tab-b",
      message: "Second matching tab",
      clientDetails: { clientKey: "democrm", userId: 120040 },
    },
  });

  const firstEvent = await dashboard.next(
    (message) => message.event?.message === "First matching tab",
  );
  const secondEvent = await dashboard.next(
    (message) => message.event?.message === "Second matching tab",
  );
  assert.equal(firstEvent.event.tabId, "tab-a");
  assert.equal(secondEvent.event.tabId, "tab-b");

  dashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "anothercrm",
    userId: 550,
  });
  await firstTab.next((message) => message.type === "STOP_LIVE");
  await secondTab.next((message) => message.type === "STOP_LIVE");
  await dashboard.next(
    (message) => message.agents[0]?.clientKey === "anothercrm",
  );

  firstTab.send({
    type: "LIVE_EVENT",
    event: {
      type: "console",
      message: "Old filter event",
      clientDetails: { clientKey: "democrm", userId: 120040 },
    },
  });
  dashboard.send({
    type: "START_LIVE",
    clientKey: "anothercrm",
    userId: 550,
  });
  await otherAgent.next((message) => message.type === "START_LIVE");
  otherAgent.send({
    type: "LIVE_EVENT",
    event: {
      type: "console",
      message: "New filter event",
      clientDetails: { clientKey: "anothercrm", userId: 550 },
    },
  });

  const newFilterEvent = await dashboard.next(
    (message) => message.event?.message === "New filter event",
  );
  assert.equal(newFilterEvent.event.clientDetails.clientKey, "anothercrm");
  assert.equal(
    dashboard
      .getMessages()
      .some((message) => message.event?.message === "Old filter event"),
    false,
  );
});

test("changing one dashboard filter keeps another dashboard's stream active", async () => {
  const url = await startLiveServer();
  const firstDashboard = await connect(url);
  const secondDashboard = await connect(url);
  const agent = await connect(url);

  for (const dashboard of [firstDashboard, secondDashboard]) {
    dashboard.send({
      type: "DASHBOARD_CONNECT",
      clientKey: "democrm",
      userId: 1,
    });
    await dashboard.next();
  }

  agent.send({
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: 1,
    tabId: "tab-a",
  });
  firstDashboard.send({
    type: "START_LIVE",
    clientKey: "democrm",
    userId: 1,
  });
  await agent.next((message) => message.type === "START_LIVE");
  secondDashboard.send({
    type: "START_LIVE",
    clientKey: "democrm",
    userId: 1,
  });
  await agent.next((message) => message.type === "START_LIVE");

  firstDashboard.send({
    type: "DASHBOARD_CONNECT",
    clientKey: "anothercrm",
    userId: 2,
  });
  await firstDashboard.next((message) => message.agents.length === 0);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    agent.getMessages().some((message) => message.type === "STOP_LIVE"),
    false,
  );

  agent.send({
    type: "LIVE_EVENT",
    event: {
      type: "console",
      message: "Still subscribed",
      clientDetails: { clientKey: "democrm", userId: 1 },
    },
  });
  const event = await secondDashboard.next(
    (message) => message.event?.message === "Still subscribed",
  );
  assert.equal(event.type, "LIVE_EVENT");
});
