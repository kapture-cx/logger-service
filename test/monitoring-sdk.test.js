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

function createClickElement({
  tagName = "button",
  innerText = "",
  attributes = {},
  interactive = true,
  ignored = false,
  recorder = false,
  checked,
  labels = [],
  multiple = false,
} = {}) {
  return {
    tagName: tagName.toUpperCase(),
    innerText,
    checked,
    labels,
    multiple,
    type: attributes.type,
    value: "must-never-be-captured",
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    matches() {
      return interactive;
    },
    closest(selector) {
      if (selector.includes("data-monitoring-ignore")) {
        return ignored || recorder ? this : null;
      }

      return interactive ? this : null;
    },
  };
}

function createBrowserContext() {
  const elements = [];
  const intervals = [];
  const listeners = new Map();
  const requests = [];
  const scripts = [];
  const timeouts = [];
  let nextId = 0;

  function createElement(tagName) {
    const elementListeners = new Map();
    const element = {
      tagName: tagName.toUpperCase(),
      children: [],
      dataset: {},
      disabled: false,
      style: {},
      value: "",
      textContent: "",
      classList: { add() {}, remove() {} },
      addEventListener(type, callback) {
        const callbacks = elementListeners.get(type) || [];
        callbacks.push(callback);
        elementListeners.set(type, callbacks);
      },
      click() {
        return Promise.all(
          (elementListeners.get("click") || []).map((callback) => callback()),
        );
      },
      submit() {
        return Promise.all(
          (elementListeners.get("submit") || []).map((callback) =>
            callback({ preventDefault() {} }),
          ),
        );
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      remove() {
        if (!this.parentNode) return;
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) this.parentNode.children.splice(index, 1);
        this.parentNode = null;
      },
      get firstElementChild() {
        return this.children[0] ?? null;
      },
      attachShadow() {
        const nodes = new Map();
        this.shadowRoot = {
          innerHTML: "",
          getElementById(id) {
            if (!nodes.has(id)) {
              const tagName = id === "details"
                ? "form"
                : id === "notifications"
                ? "div"
                : "button";
              nodes.set(id, createElement(tagName));
            }
            return nodes.get(id);
          },
        };
        return this.shadowRoot;
      },
    };

    elements.push(element);
    return element;
  }

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
      body: {
        appendChild(element) {
          element.parentNode = this;
        },
      },
      currentScript: {
        src: "https://logger.example.com/monitoring/v1/monitoring.min.js",
        dataset: {
          app: "kapturecrm-ui",
        },
      },
      hidden: false,
      head: {
        appendChild(element) {
          if (element.tagName === "SCRIPT") {
            scripts.push(element);
          }
        },
      },
      createElement,
      addEventListener(type, callback) {
        const callbacks = listeners.get(type) || new Set();
        callbacks.add(callback);
        listeners.set(type, callbacks);
      },
      dispatchEvent(event) {
        listeners.get(event.type)?.forEach((callback) => callback(event));
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
      json: async () => ({
        data: { id: "123e4567-e89b-42d3-a456-426614174000" },
      }),
      };
    },
    location: { href: "https://crm.example.com/nui/" },
    history: {
      pushState() {},
      replaceState() {},
    },
    localStorage: createStorage(),
    confirm: () => true,
    performance: { now: () => 1 },
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval() {},
    setTimeout(callback, delay) {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
    clearTimeout() {},
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

  return {
    browser,
    elements,
    intervals,
    listeners,
    requests,
    scripts,
    timeouts,
  };
}

function createFakeWebSocket() {
  return class FakeWebSocket {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.listeners = new Map();
      FakeWebSocket.instances.push(this);
    }

    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || new Set();
      callbacks.add(callback);
      this.listeners.set(type, callbacks);
    }

    emit(type, event = {}) {
      this.listeners.get(type)?.forEach((callback) => callback(event));
    }

    open() {
      this.readyState = 1;
      this.emit("open");
    }

    receive(message) {
      this.emit("message", {
        data: typeof message === "string" ? message : JSON.stringify(message),
      });
    }

    send(message) {
      this.sent.push(JSON.parse(message));
    }

    close() {
      this.readyState = 3;
      this.emit("close");
    }
  };
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

test("semantic clicks use text and safe fallbacks while respecting exclusions", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, listeners, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  vm.runInContext(bundle, context);
  vm.runInContext(bundle, context);
  assert.equal(listeners.get("click").size, 1);

  const button = createClickElement({
    innerText: `  Create   ${"Customer ".repeat(20)}`,
    attributes: { "data-monitoring-name": "stable-create-customer" },
  });
  const icon = createClickElement({ tagName: "span", interactive: false });
  browser.document.dispatchEvent({
    type: "click",
    target: icon,
    composedPath: () => [icon, button],
  });

  const input = createClickElement({
    tagName: "input",
    attributes: {
      type: "text",
      "data-monitoring-name": "customer-search",
      "aria-label": "Search customers",
      name: "search",
      id: "search-input",
    },
  });
  browser.document.dispatchEvent({
    type: "click",
    target: input,
    composedPath: () => [input],
  });

  const checkbox = createClickElement({
    tagName: "input",
    attributes: { type: "checkbox" },
    checked: true,
    labels: [{ innerText: "  Enable   notifications  " }],
  });
  browser.document.dispatchEvent({
    type: "click",
    target: checkbox,
    composedPath: () => [checkbox],
  });

  const ordinaryDiv = createClickElement({ tagName: "div", interactive: false });
  const ignoredButton = createClickElement({ innerText: "Sensitive action", ignored: true });
  const recorderButton = createClickElement({ innerText: "Stop recording", recorder: true });

  for (const target of [ordinaryDiv, ignoredButton, recorderButton]) {
    browser.document.dispatchEvent({
      type: "click",
      target,
      composedPath: () => [target],
    });
  }

  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.events.length, 3);
  assert.equal(payload.events[0].type, "user-click");
  assert.equal(payload.events[0].element, "button");
  assert.equal(payload.events[0].controlType, "button");
  assert.equal(payload.events[0].buttonType, "submit");
  assert.equal(payload.events[0].monitoringName, "stable-create-customer");
  assert.equal(payload.events[0].role, "button");
  assert.equal(payload.events[0].label.length, 100);
  assert.match(payload.events[0].label, /^Create Customer/);
  assert.equal(payload.events[1].element, "input");
  assert.equal(payload.events[1].controlType, "text");
  assert.equal(payload.events[1].label, "customer-search");
  assert.equal(payload.events[1].controlName, "search");
  assert.equal(payload.events[1].inputType, "text");
  assert.equal(payload.events[2].element, "input");
  assert.equal(payload.events[2].controlType, "checkbox");
  assert.equal(payload.events[2].label, "Enable notifications");
  assert.equal(payload.events[2].inputType, "checkbox");
  assert.equal(payload.events[2].checked, true);
  assert.equal(JSON.stringify(payload).includes("must-never-be-captured"), false);
  assert.equal(JSON.stringify(payload).includes("Sensitive action"), false);
  assert.equal(JSON.stringify(payload).includes("Stop recording"), false);
});

test("semantic clicks receive incident correlation and live forwarding", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, elements, requests } = createBrowserContext();
  const FakeWebSocket = createFakeWebSocket();
  browser.WebSocket = FakeWebSocket;
  browser.document.currentScript.dataset.incidentRecorder = "true";
  browser.document.currentScript.dataset.websocketEndPoint =
    "ws://localhost:5001/api/live-monitoring";
  browser.__KaptureIncidentRecorder = { record: () => () => {} };
  const context = vm.createContext(browser);

  vm.runInContext(
    `window.KaptureMonitoringConfig = {
      getClientDetails: () => ({ clientKey: "democrm", userId: 1 })
    }`,
    context,
  );
  vm.runInContext(bundle, context);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.receive({ type: "START_LIVE" });
  const recorderHost = elements.find((element) => element.dataset.kaptureRecorder);
  await recorderHost.shadowRoot.getElementById("record").click();

  const button = createClickElement({ innerText: "Create Customer" });
  browser.document.dispatchEvent({
    type: "click",
    target: button,
    composedPath: () => [button],
  });
  await browser.MonitoringService.flush();

  const logRequest = requests.find((request) =>
    request.url.endsWith("/api/logs"),
  );
  const click = JSON.parse(logRequest.options.body).events[0];
  const liveClick = socket.sent.find(
    (message) => message.type === "LIVE_EVENT" && message.event.type === "user-click",
  );

  assert.equal(click.label, "Create Customer");
  assert.equal(click.incidentId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(typeof click.incidentOffsetMs, "number");
  assert.equal(liveClick.event.incidentId, click.incidentId);
});

test("semantic clicks describe each supported kind of interactive control", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  vm.runInContext(bundle, vm.createContext(browser));

  const controls = [
    createClickElement({ tagName: "a", innerText: "Customer details" }),
    createClickElement({
      tagName: "select",
      attributes: { name: "region", type: "select-multiple" },
      multiple: true,
    }),
    createClickElement({ tagName: "textarea", attributes: { name: "notes" } }),
    createClickElement({ tagName: "summary", innerText: "Advanced options" }),
    createClickElement({
      tagName: "div",
      attributes: { role: "tab", "aria-label": "Activity" },
    }),
    createClickElement({
      tagName: "div",
      attributes: { "data-monitoring-name": "custom-action" },
    }),
  ];

  controls.forEach((target) => browser.document.dispatchEvent({
    type: "click",
    target,
    composedPath: () => [target],
  }));
  intervals[0]();
  await Promise.resolve();

  const events = JSON.parse(requests[0].options.body).events;
  assert.deepEqual(
    events.map((event) => event.controlType),
    ["link", "select-multiple", "textarea", "disclosure", "tab", "div"],
  );
  assert.equal(events[1].selectType, "select-multiple");
  assert.equal(events[1].controlName, "region");
  assert.equal(events[2].controlName, "notes");
  assert.equal(events[3].role, "button");
  assert.equal(events[4].role, "tab");
  assert.equal(events[5].monitoringName, "custom-action");
});

test("the incident recorder widget is opt-in and lazily loads its bundle", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const disabled = createBrowserContext();

  vm.runInContext(bundle, vm.createContext(disabled.browser));
  assert.equal(
    disabled.elements.filter((element) => element.dataset.kaptureRecorder).length,
    0,
  );

  const enabled = createBrowserContext();
  enabled.browser.document.currentScript.dataset.incidentRecorder = "true";
  const context = vm.createContext(enabled.browser);

  vm.runInContext(bundle, context);

  const hosts = enabled.elements.filter(
    (element) => element.dataset.kaptureRecorder,
  );
  assert.equal(hosts.length, 1);
  assert.equal(enabled.scripts.length, 0);

  hosts[0].shadowRoot.getElementById("record").click();
  assert.equal(enabled.scripts.length, 1);
  assert.equal(
    enabled.scripts[0].src,
    "https://logger.example.com/monitoring/v1/incident-recorder.min.js",
  );

  vm.runInContext(bundle, context);
  assert.equal(
    enabled.elements.filter((element) => element.dataset.kaptureRecorder).length,
    1,
  );
});

test("the incident recorder correlates, uploads, stops, and completes", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, elements, intervals, requests, timeouts } =
    createBrowserContext();
  browser.document.currentScript.dataset.incidentRecorder = "true";
  let recorderOptions;
  let recorderStopped = false;
  browser.__KaptureIncidentRecorder = {
    record(options) {
      recorderOptions = options;
      return () => {
        recorderStopped = true;
      };
    },
  };

  vm.runInContext(bundle, vm.createContext(browser));

  const host = elements.find((element) => element.dataset.kaptureRecorder);
  const recordButton = host.shadowRoot.getElementById("record");
  await recordButton.click();

  assert.equal(recordButton.textContent, "■ Stop recording");
  assert.equal(requests[0].url, "https://logger.example.com/api/incidents");

  recorderOptions.emit({ type: 2, timestamp: Date.now() });
  await intervals[1]();

  assert.equal(
    requests[1].url,
    "https://logger.example.com/api/incidents/123e4567-e89b-42d3-a456-426614174000/chunks",
  );
  assert.equal(JSON.parse(requests[1].options.body).sequence, 0);

  const maximumDuration = timeouts.find(({ delay }) => delay === 300000);
  maximumDuration.callback();
  assert.equal(recorderStopped, true);
  assert.equal(host.shadowRoot.getElementById("details").style.display, "block");

  host.shadowRoot.getElementById("title").value = "Customer form failed";
  await host.shadowRoot.getElementById("details").submit();

  assert.equal(
    requests.at(-1).url,
    "https://logger.example.com/api/incidents/123e4567-e89b-42d3-a456-426614174000/complete",
  );
  assert.equal(recordButton.textContent, "● Record incident");
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
  assert.equal(payload.events[0].timestamp, payload.events[0].leftAt);
  assert.ok(!Number.isNaN(Date.parse(payload.events[0].timestamp)));
});

test("page monitoring restarts when a hidden tab becomes visible", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const context = vm.createContext(browser);

  vm.runInContext(bundle, context);

  browser.document.hidden = true;
  browser.dispatchEvent({ type: "visibilitychange" });
  browser.location.href = "https://crm.example.com/nui/customers";
  browser.document.hidden = false;
  browser.dispatchEvent({ type: "visibilitychange" });
  browser.document.hidden = true;
  browser.dispatchEvent({ type: "visibilitychange" });
  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests[0].options.body);

  assert.deepEqual(
    payload.events.map((event) => [event.reason, event.url]),
    [
      ["tab-hidden", "https://crm.example.com/nui/"],
      ["tab-hidden", "https://crm.example.com/nui/customers"],
    ],
  );
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

test("live monitoring uses only the explicit WebSocket script attribute", async () => {
  const bundle = await readFile(bundlePath, "utf8");

  for (const websocketEndPoint of [undefined, "https://logger.example.com/live"]) {
    const { browser } = createBrowserContext();
    const FakeWebSocket = createFakeWebSocket();
    browser.WebSocket = FakeWebSocket;
    browser.document.currentScript.dataset.websocketEndPoint = websocketEndPoint;

    vm.runInContext(bundle, vm.createContext(browser));
    assert.equal(FakeWebSocket.instances.length, 0);
  }
});

test("live events are additive and stop without affecting HTTP reporting", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, intervals, requests } = createBrowserContext();
  const FakeWebSocket = createFakeWebSocket();
  browser.WebSocket = FakeWebSocket;
  browser.document.currentScript.dataset.websocketEndPoint =
    "ws://localhost:5001/api/live-monitoring";
  const context = vm.createContext(browser);

  vm.runInContext(
    `window.KaptureMonitoringConfig = {
      getClientDetails: () => ({
        clientKey: "democrm",
        userId: 120040,
        agent: "Ankit Tiwari",
        designation: "Super Admin",
        host: "democrm.kapturecrm.com"
      })
    }`,
    context,
  );
  vm.runInContext(bundle, context);

  assert.equal(FakeWebSocket.instances.length, 1);
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, "ws://localhost:5001/api/live-monitoring");
  socket.open();

  assert.deepEqual(socket.sent[0], {
    type: "AGENT_CONNECT",
    clientKey: "democrm",
    userId: "120040",
    tabId: "event-1",
    app: "kapturecrm-ui",
    agent: "Ankit Tiwari",
    designation: "Super Admin",
    host: "democrm.kapturecrm.com",
  });

  socket.receive({ type: "START_LIVE" });
  browser.console.log("Streamed and queued");

  const liveEvent = socket.sent.find((message) => message.type === "LIVE_EVENT");
  assert.equal(liveEvent.event.message, "Streamed and queued");
  assert.equal(liveEvent.event.app, "kapturecrm-ui");
  assert.equal(liveEvent.event.clientDetails.userId, 120040);

  socket.receive({ type: "STOP_LIVE" });
  browser.console.info("Queued only");
  assert.equal(
    socket.sent.filter((message) => message.type === "LIVE_EVENT").length,
    1,
  );

  intervals[0]();
  await Promise.resolve();

  const payload = JSON.parse(requests[0].options.body);
  assert.deepEqual(
    payload.events.map((event) => event.message),
    ["Streamed and queued", "Queued only"],
  );
});

test("live instructions render safe dismissible notifications only while monitoring", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, elements } = createBrowserContext();
  const FakeWebSocket = createFakeWebSocket();
  browser.WebSocket = FakeWebSocket;
  browser.document.currentScript.dataset.websocketEndPoint =
    "ws://localhost:5001/api/live-monitoring";
  const context = vm.createContext(browser);

  vm.runInContext(
    `window.KaptureMonitoringConfig = {
      getClientDetails: () => ({ clientKey: "democrm", userId: 120040 })
    }`,
    context,
  );
  vm.runInContext(bundle, context);

  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.receive({
    type: "AGENT_INSTRUCTION",
    instruction: { text: "Ignored before start" },
  });
  assert.equal(
    elements.some((element) => element.dataset.kaptureInstructions),
    false,
  );

  socket.receive({ type: "START_LIVE" });
  socket.receive({
    type: "AGENT_INSTRUCTION",
    instruction: {
      text: "<img src=x onerror=alert(1)> Please retry.",
      sentAt: "2026-09-22T10:30:00.000Z",
    },
  });

  const host = elements.find(
    (element) => element.dataset.kaptureInstructions === "true",
  );
  const notifications = host.shadowRoot.getElementById("notifications");
  assert.equal(notifications.children.length, 1);
  assert.equal(
    notifications.children[0].children[1].textContent,
    "<img src=x onerror=alert(1)> Please retry.",
  );

  for (let index = 2; index <= 6; index += 1) {
    socket.receive({
      type: "AGENT_INSTRUCTION",
      instruction: {
        text: `Message ${index}`,
        sentAt: "2026-09-22T10:30:00.000Z",
      },
    });
  }

  assert.equal(notifications.children.length, 5);
  assert.equal(notifications.children[0].children[1].textContent, "Message 2");
  const dismissButton = notifications.children[0].children[0].children[1];
  await dismissButton.click();
  assert.equal(notifications.children.length, 4);

  socket.receive({ type: "STOP_LIVE" });
  socket.receive({
    type: "AGENT_INSTRUCTION",
    instruction: { text: "Ignored after stop" },
  });
  socket.receive({ type: "START_LIVE" });
  socket.receive({
    type: "AGENT_INSTRUCTION",
    instruction: { text: "x".repeat(501) },
  });
  socket.receive({
    type: "AGENT_INSTRUCTION",
    instruction: { text: 123 },
  });
  assert.equal(notifications.children.length, 4);
});

test("a live instruction waits for the document body before rendering", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, elements } = createBrowserContext();
  const FakeWebSocket = createFakeWebSocket();
  browser.WebSocket = FakeWebSocket;
  browser.document.body = null;
  browser.document.currentScript.dataset.websocketEndPoint =
    "ws://localhost:5001/api/live-monitoring";
  const context = vm.createContext(browser);

  vm.runInContext(
    `window.KaptureMonitoringConfig = {
      getClientDetails: () => ({ clientKey: "democrm", userId: 120040 })
    }`,
    context,
  );
  vm.runInContext(bundle, context);

  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.receive({ type: "START_LIVE" });
  socket.receive({
    type: "AGENT_INSTRUCTION",
    instruction: {
      text: "Wait for the page",
      sentAt: "2026-09-22T10:30:00.000Z",
    },
  });
  assert.equal(
    elements.some((element) => element.dataset.kaptureInstructions),
    false,
  );

  browser.document.body = {
    appendChild(element) {
      element.parentNode = this;
    },
  };
  browser.dispatchEvent({ type: "DOMContentLoaded" });

  const host = elements.find(
    (element) => element.dataset.kaptureInstructions === "true",
  );
  const notifications = host.shadowRoot.getElementById("notifications");
  assert.equal(notifications.children.length, 1);
  assert.equal(
    notifications.children[0].children[1].textContent,
    "Wait for the page",
  );
});

test("live monitoring re-registers safely when the agent identity changes", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser } = createBrowserContext();
  const FakeWebSocket = createFakeWebSocket();
  browser.WebSocket = FakeWebSocket;
  browser.document.currentScript.dataset.websocketEndPoint =
    "wss://logger.example.com/api/live-monitoring";
  const context = vm.createContext(browser);

  vm.runInContext(
    `window.currentClient = { clientKey: "democrm", userId: 1 };
     window.KaptureMonitoringConfig = {
       getClientDetails: () => window.currentClient
     }`,
    context,
  );
  vm.runInContext(bundle, context);

  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.receive({ type: "START_LIVE" });
  browser.currentClient = { clientKey: "democrm", userId: 2 };
  browser.console.log("Identity changed");

  assert.deepEqual(
    socket.sent.slice(-2).map((message) => message.type),
    ["AGENT_DISCONNECT", "AGENT_CONNECT"],
  );
  assert.equal(socket.sent.at(-1).userId, "2");
  assert.equal(
    socket.sent.some(
      (message) =>
        message.type === "LIVE_EVENT" &&
        message.event.message === "Identity changed",
    ),
    false,
  );

  browser.currentClient = {};
  browser.console.warn("Logged out");
  assert.equal(socket.sent.at(-1).type, "AGENT_DISCONNECT");
  assert.equal(
    socket.sent.some(
      (message) =>
        message.type === "LIVE_EVENT" && message.event.message === "Logged out",
    ),
    false,
  );
});

test("live monitoring reconnects with backoff after a connection closes", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const { browser, timeouts } = createBrowserContext();
  const FakeWebSocket = createFakeWebSocket();
  browser.WebSocket = FakeWebSocket;
  browser.document.currentScript.dataset.websocketEndPoint =
    "ws://localhost:5001/api/live-monitoring";

  vm.runInContext(bundle, vm.createContext(browser));
  FakeWebSocket.instances[0].close();

  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delay, 1000);
  timeouts[0].callback();
  assert.equal(FakeWebSocket.instances.length, 2);
});
