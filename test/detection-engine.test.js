import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildDetections } from "../src/detectionEngine.js";

function event(overrides = {}) {
  return {
    id: randomUUID(),
    app: "kapturecrm-ui",
    clientDetails: { cmId: 8400, clientKey: "democrm" },
    sessionId: "session-1",
    timestamp: "2026-09-21T10:00:00.000Z",
    ...overrides,
  };
}

test("detects API failures while normalizing query strings and fragments", () => {
  const events = [
    event({ type: "api-request", method: "post", url: "/api/customers?one=1", statusCode: 500 }),
    event({ type: "api-request", method: "POST", url: "/api/customers#form", status: "error" }),
    event({ type: "api-request", method: "POST", url: "/api/customers?two=2", statusCode: 400 }),
    event({ type: "api-request", method: "POST", url: "/api/customers", statusCode: 200 }),
  ];
  const detections = buildDetections(events);

  assert.equal(detections.length, 1);
  assert.equal(detections[0].type, "api-failure");
  assert.equal(detections[0].customerName, "democrm");
  assert.equal(detections[0].occurrenceCount, 3);
  assert.equal(detections[0].evidence[0].url, "/api/customers");
  assert.match(detections[0].summary, /3 of 4/);
});

test("detects runtime, slow API, and console error bursts at three events", () => {
  const detections = buildDetections([
    ...Array.from({ length: 3 }, (_, index) => event({
      type: "javascript-error",
      message: index === 1 ? "Cannot   save" : "Cannot save",
      sessionId: `runtime-${index}`,
    })),
    ...Array.from({ length: 3 }, () => event({
      type: "api-request",
      method: "GET",
      url: "/api/orders",
      statusCode: 200,
      duration: 500,
    })),
    ...Array.from({ length: 3 }, () => event({
      type: "console",
      level: "error",
      message: "Rendering failed",
    })),
  ]);

  assert.deepEqual(
    detections.map((detection) => detection.type).sort(),
    ["console-error", "javascript-error", "slow-api"],
  );
  assert.equal(
    detections.find((detection) => detection.type === "javascript-error").affectedSessions,
    3,
  );
});

test("ignores events below thresholds and without cmId", () => {
  const detections = buildDetections([
    event({ type: "promise-error", message: "Rejected" }),
    event({ type: "promise-error", message: "Rejected" }),
    event({ type: "console", level: "error", message: "No customer", clientDetails: {} }),
  ]);

  assert.deepEqual(detections, []);
});

test("isolates customers and limits compact evidence to five events", () => {
  const events = [8400, 9200].flatMap((cmId) =>
    Array.from({ length: 6 }, (_, index) => event({
      type: "promise-error",
      message: "Request rejected",
      id: `event-${cmId}-${index}`,
      clientDetails: { cmId },
    })),
  );
  const detections = buildDetections(events);

  assert.equal(detections.length, 2);
  assert.notEqual(detections[0].fingerprint, detections[1].fingerprint);
  assert.equal(detections[0].evidence.length, 5);
  assert.equal("responseData" in detections[0].evidence[0], false);
});
