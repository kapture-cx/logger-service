import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const bundlePath = path.resolve("public/monitoring/v1/monitoring.min.js");

function createStorage() {
  const values = new Map();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      const normalizedKey = String(key);
      return values.has(normalizedKey) ? values.get(normalizedKey) : null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

function createBrowserContext() {
  const intervals = [];
  const listeners = new Map();
  const requests = [];
  let nextId = 0;

  const browser = {
    ArrayBuffer,
    Blob,
    FormData,
    Headers,
    Request,
    URL,
    URLSearchParams,
    Uint8Array,
    console: {
      log() {},
      info() {},
      warn() {},
      error() {},
      debug() {},
      table() {},
      group() {},
      groupEnd() {},
    },
    crypto: {
      randomUUID() {
        nextId += 1;
        return `event-${nextId}`;
      },
    },
    document: {
      currentScript: {
        src: "https://logger.example.com/monitoring/v1/monitoring.min.js",
        dataset: {
          app: "kapturecrm-ui",
        },
      },
      hidden: false,
      addEventListener(type, callback) {
        const callbacks = listeners.get(type) || new Set();
        callbacks.add(callback);
        listeners.set(type, callbacks);
      },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        clone() {
          return { text: async () => '{"ok":true}' };
        },
      };
    },
    location: { href: "https://crm.example.com/nui/" },
    history: {
      pushState() {},
      replaceState() {},
    },
    localStorage: createStorage(),
    performance: { now: () => 1 },
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || new Set();
      callbacks.add(callback);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.forEach((callback) => callback(event));
    },
  };

  browser.window = browser;
  browser.globalThis = browser;

  return { browser, intervals, requests };
}

test("the browser SDK derives its endpoint and reads current client details", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  vm.runInContext(bundle, context);

  const publicApi = browser.KaptureMonitoring;
  const identityApi = browser.MonitoringService;
  const firstConsoleLog = browser.console.log;
  assert.equal(typeof publicApi.setClientDetailsProvider, "function");
  assert.equal(publicApi.name, "kapture-monitoring");
  assert.equal(publicApi.version, 1);

  browser.reduxState = { userId: "123", tenantId: "acme" };
  let providerCalls = 0;

  assert.equal(
    publicApi.setClientDetailsProvider(() => {
      providerCalls += 1;
      return browser.reduxState;
    }),
    true,
  );

  vm.runInContext(bundle, context);

  assert.equal(intervals.length, 1);
  assert.equal(browser.console.log, firstConsoleLog);
  assert.equal(browser.KaptureMonitoring, publicApi);
  assert.equal(browser.MonitoringService, identityApi);

  browser.console.log("First event");
  browser.console.info("Second event");
  browser.reduxState.userId = "456";
  browser.console.warn("Third event");

  assert.equal(providerCalls, 3);
  intervals[0]();
  await Promise.resolve();

  assert.equal(providerCalls, 5);
  assert.equal(requests.length, 1);

  const payload = JSON.parse(requests[0].options.body);

  assert.deepEqual(Object.keys(payload).sort(), [
    "app",
    "clientDetails",
    "events",
  ]);
  assert.equal(payload.app, "kapturecrm-ui");

  assert.equal(requests[0].url, "https://logger.example.com/api/logs");
  assert.equal(payload.events.length, 3);
  assert.deepEqual(payload.clientDetails, {
    userId: "456",
    tenantId: "acme",
  });
});

test("the browser SDK reports the final page transition during unload", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  vm.runInContext(bundle, context);

  browser.dispatchEvent({ type: "pagehide", persisted: false });
  await Promise.resolve();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.keepalive, true);

  const payload = JSON.parse(requests[0].options.body);

  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].type, "page-transition");
  assert.equal(payload.events[0].reason, "page-unloaded");
  assert.equal(payload.events[0].url, "https://crm.example.com/nui/");
});

test("the public identity API controls the session on future events", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  assert.equal(browser.localStorage.getItem("monitoring_session_id"), null);

  vm.runInContext(bundle, context);

  const identityApi = browser.MonitoringService;

  assert.ok(identityApi);
  assert.deepEqual(Object.keys(identityApi).sort(), [
    "clearSessionId",
    "setSessionId",
  ]);
  assert.equal(Object.isFrozen(identityApi), true);
  assert.equal(typeof identityApi.setSessionId, "function");
  assert.equal(typeof identityApi.clearSessionId, "function");
  assert.equal(identityApi.getSessionId, undefined);
  assert.equal(identityApi.getTabId, undefined);
  assert.equal(identityApi.createPageViewId, undefined);

  browser.console.log("Anonymous event");

  assert.equal(identityApi.setSessionId("  TEST-SESSION-123  "), true);
  assert.equal(
    browser.localStorage.getItem("monitoring_session_id"),
    "TEST-SESSION-123",
  );

  browser.console.info("Authenticated event");

  for (const invalidSessionId of [null, undefined, "", "   "]) {
    assert.equal(identityApi.setSessionId(invalidSessionId), false);
    assert.equal(
      browser.localStorage.getItem("monitoring_session_id"),
      "TEST-SESSION-123",
    );
  }

  assert.equal(identityApi.clearSessionId(), true);
  assert.equal(browser.localStorage.getItem("monitoring_session_id"), null);

  browser.console.warn("Logged-out event");
  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests[0].options.body);

  assert.deepEqual(
    payload.events.map((event) => [event.message, event.sessionId]),
    [
      ["Anonymous event", null],
      ["Authenticated event", "TEST-SESSION-123"],
      ["Logged-out event", null],
    ],
  );
});

test("the identity API merges into an existing MonitoringService object", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser } = createBrowserContext();
  const context = vm.createContext(browser);
  const existingApi = {
    start() {
      return "existing start";
    },
    stop() {
      return "existing stop";
    },
  };

  browser.MonitoringService = existingApi;
  vm.runInContext(bundle, context);

  assert.equal(browser.MonitoringService, existingApi);
  assert.equal(browser.MonitoringService.start(), "existing start");
  assert.equal(browser.MonitoringService.stop(), "existing stop");
  assert.equal(typeof browser.MonitoringService.setSessionId, "function");
  assert.equal(typeof browser.MonitoringService.clearSessionId, "function");
  assert.equal(
    typeof browser.KaptureMonitoring.setClientDetailsProvider,
    "function",
  );
});

test("the identity API fails safely when local storage is unavailable", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);
  const storageError = new Error("Storage is disabled");

  browser.localStorage = {
    getItem() {
      throw storageError;
    },
    removeItem() {
      throw storageError;
    },
    setItem() {
      throw storageError;
    },
  };

  vm.runInContext(bundle, context);

  assert.equal(browser.MonitoringService.setSessionId("SESSION-123"), false);
  assert.equal(browser.MonitoringService.clearSessionId(), false);

  browser.console.log("Storage-disabled event");
  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests[0].options.body);

  assert.equal(payload.events[0].sessionId, null);
});

test("event enrichment preserves a tracker's explicit session snapshot", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  vm.runInContext(bundle, context);
  browser.MonitoringService.setSessionId("CURRENT-SESSION");
  browser.__captureErrorBoundaryEvent(
    new Error("Page transition failed"),
    {},
    { sessionId: "PAGE-START-SESSION" },
  );

  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests[0].options.body);

  assert.equal(payload.events[0].sessionId, "PAGE-START-SESSION");
});

test("default console rules apply when cmId is unavailable or unknown", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  vm.runInContext(bundle, context);
  browser.KaptureMonitoring.setClientDetailsProvider(() => ({ cmId: "unknown" }));

  browser.console.log("jwt_access_token exists: false NULL");
  browser.console.warn("null EXPIRYTIMESTAMP (MS) INVALID");
  browser.console.info("Useful console message");
  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests.at(-1).options.body);
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].message, "Useful console message");
});

test("cmId-specific console rules are additive and apply after cmId becomes available", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);
  let clientDetails = {};

  vm.runInContext(bundle, context);
  browser.KaptureMonitoring.setClientDetailsProvider(() => clientDetails);

  browser.console.log("Exact client message");
  clientDetails = { cmId: 415 };
  browser.console.log("EXACT CLIENT MESSAGE");
  browser.console.warn("Prefix partial client phrase suffix");
  browser.console.info("Registering the ping handler");
  browser.console.error("Client-visible message");
  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests.at(-1).options.body);
  assert.deepEqual(
    payload.events.map((event) => event.message),
    ["Exact client message", "Client-visible message"],
  );
  assert.deepEqual(payload.clientDetails, { cmId: 415 });
});

test("default and cmId-specific URL rules ignore an entire origin", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);
  let clientDetails = { cmId: "unknown" };

  vm.runInContext(bundle, context);
  browser.KaptureMonitoring.setClientDetailsProvider(() => clientDetails);

  await browser.fetch("https://firebaselogging-pa.googleapis.com/v1/firelog");
  await browser.fetch("https://client-service.example.com/before-cm-id");
  clientDetails = { cmId: "415" };
  await browser.fetch("https://client-service.example.com/after-cm-id");
  await browser.fetch("https://api.example.com/orders");
  await Promise.resolve();
  await Promise.resolve();

  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests.at(-1).options.body);
  assert.deepEqual(
    payload.events.map((event) => event.url),
    [
      "https://client-service.example.com/before-cm-id",
      "https://api.example.com/orders",
    ],
  );
});

test("legacy configuration supplies the endpoint and latest batch context", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  browser.document.currentScript.dataset = {};
  vm.runInContext(
    `window.legacyUserId = "first-user";
     window.KaptureMonitoringConfig = {
       endpoint: "https://legacy.example.com/api/logs",
       app: "legacy-app",
       getClientDetails: () => ({ userId: window.legacyUserId })
     }`,
    context,
  );
  vm.runInContext(bundle, context);

  browser.console.log("First legacy event");
  browser.legacyUserId = "second-user";
  browser.console.log("Second legacy event");
  intervals[0]();
  await Promise.resolve();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://legacy.example.com/api/logs");

  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.app, "legacy-app");
  assert.equal(payload.events.length, 2);
  assert.deepEqual(payload.clientDetails, { userId: "second-user" });
});

test("the SDK replaces an unbranded configurable namespace collision", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser } = createBrowserContext();
  const context = vm.createContext(browser);
  const collidingApi = {
    setClientDetailsProvider() {
      throw new Error("Unrelated API must not be called");
    },
  };

  browser.KaptureMonitoring = collidingApi;
  vm.runInContext(bundle, context);

  assert.notEqual(browser.KaptureMonitoring, collidingApi);
  assert.equal(browser.KaptureMonitoring.name, "kapture-monitoring");
  assert.equal(
    browser.KaptureMonitoring.setClientDetailsProvider(() => ({})),
    true,
  );
});

test("script attributes override legacy global configuration", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  browser.document.currentScript.dataset.endpoint =
    "https://override.example.com/custom/logs";
  browser.document.currentScript.dataset.app = "attribute-app";

  vm.runInContext(
    `window.KaptureMonitoringConfig = {
      endpoint: "https://legacy.example.com/api/logs",
      app: "legacy-app",
      getClientDetails: () => ({ userId: "legacy-user" })
    }`,
    context,
  );
  vm.runInContext(bundle, context);

  browser.console.error("Legacy provider event");
  intervals[0]();
  await Promise.resolve();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://override.example.com/custom/logs");

  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.app, "attribute-app");
  assert.equal(payload.events.length, 1);
  assert.deepEqual(payload.clientDetails, { userId: "legacy-user" });
});

test("invalid client details do not stop a batch request", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  vm.runInContext(bundle, context);

  assert.equal(browser.KaptureMonitoring.setClientDetailsProvider(null), false);
  browser.KaptureMonitoring.setClientDetailsProvider(() => {
    throw new Error("Redux is unavailable");
  });
  browser.console.warn("Throwing provider");

  intervals[0]();
  await Promise.resolve();

  assert.equal(requests.length, 1);

  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.events.length, 1);
  assert.deepEqual(payload.clientDetails, {});
});
