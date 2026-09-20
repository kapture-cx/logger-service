import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { createApp, getAllowedOrigins } from "../src/app.js";

let baseUrl;
let server;

before(async () => {
  const app = createApp({
    allowedOrigins: [
      "http://localhost:3000",
      "https://crm.example.com",
    ],
  });

  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error) =>
      error ? reject(error) : resolve(),
    );
    server.once("error", reject);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server?.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("parses the plural origin allowlist and supports the legacy variable", () => {
  assert.deepEqual(
    getAllowedOrigins({
      FRONTEND_ORIGINS:
        "http://localhost:3000, https://crm.example.com,  ",
    }),
    ["http://localhost:3000", "https://crm.example.com"],
  );
  assert.deepEqual(
    getAllowedOrigins({ FRONTEND_ORIGIN: "https://legacy.example.com" }),
    ["https://legacy.example.com"],
  );
});

test("serves the v1 monitoring bundle publicly with safe revalidation headers", async () => {
  const response = await fetch(`${baseUrl}/monitoring/v1/monitoring.min.js`, {
    headers: { Origin: "https://unlisted.example.com" },
  });
  const bundle = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
  );
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "cross-origin",
  );
  assert.ok(response.headers.get("etag"));
  assert.ok(bundle.length > 1_000);
});

test("serves the lazy v1 incident recorder bundle", async () => {
  const response = await fetch(
    `${baseUrl}/monitoring/v1/incident-recorder.min.js`,
  );
  const bundle = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.ok(bundle.length > 1_000);
});

test("revalidates the v1 monitoring bundle URL with its ETag", async () => {
  const firstResponse = await fetch(
    `${baseUrl}/monitoring/v1/monitoring.min.js`,
  );
  const etag = firstResponse.headers.get("etag");
  const secondStatus = await new Promise((resolve, reject) => {
    const request = http.get(
      `${baseUrl}/monitoring/v1/monitoring.min.js`,
      { headers: { "If-None-Match": etag } },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
  });

  assert.equal(secondStatus, 304);
});

test("does not serve the removed unversioned monitoring bundle URL", async () => {
  const response = await fetch(`${baseUrl}/monitoring/monitoring.min.js`);

  assert.equal(response.status, 404);
});

for (const origin of [
  "http://localhost:3000",
  "https://crm.example.com",
]) {
  test(`allows API requests from ${origin}`, async () => {
    const response = await fetch(`${baseUrl}/api/logs`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  });
}

test("rejects API requests from an origin outside the allowlist", async () => {
  const response = await fetch(`${baseUrl}/api/logs`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://unlisted.example.com",
      "Access-Control-Request-Method": "POST",
    },
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.message, "Origin is not allowed");
});

test("continues to support origin-less API clients", async () => {
  const response = await fetch(`${baseUrl}/api/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app: "kapturecrm-ui" }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.message, "events must be an array");
});

test("validates an incident id before accessing storage", async () => {
  const response = await fetch(`${baseUrl}/api/incidents/not-a-uuid`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.message, "incident id must be a valid UUID");
});

test("validates incident discovery filters before accessing storage", async () => {
  const missingAppResponse = await fetch(`${baseUrl}/api/incidents`);
  const missingAppBody = await missingAppResponse.json();

  assert.equal(missingAppResponse.status, 400);
  assert.equal(missingAppBody.message, "app must be a non-empty string");

  const invalidCmIdResponse = await fetch(
    `${baseUrl}/api/incidents?app=kapturecrm-ui&cmId=%20`,
  );
  const invalidCmIdBody = await invalidCmIdResponse.json();

  assert.equal(invalidCmIdResponse.status, 400);
  assert.equal(invalidCmIdBody.message, "cmId must be a non-empty string");
});

test("validates live sessions and generic AI requests before accessing storage", async () => {
  const detectionsResponse = await fetch(`${baseUrl}/api/detections`);
  const detectionsBody = await detectionsResponse.json();

  assert.equal(detectionsResponse.status, 400);
  assert.equal(detectionsBody.message, "app must be a non-empty string");

  const listResponse = await fetch(`${baseUrl}/api/live-sessions`);
  const listBody = await listResponse.json();

  assert.equal(listResponse.status, 400);
  assert.equal(listBody.message, "clientKey must be a non-empty string");

  const detailResponse = await fetch(`${baseUrl}/api/live-sessions/not-a-uuid`);
  const detailBody = await detailResponse.json();

  assert.equal(detailResponse.status, 400);
  assert.equal(detailBody.message, "live session id must be a valid UUID");

  const liveSessionResponse = await fetch(`${baseUrl}/api/live-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: "democrm", userId: "120040", events: [] }),
  });
  const liveSessionBody = await liveSessionResponse.json();

  assert.equal(liveSessionResponse.status, 400);
  assert.equal(liveSessionBody.message, "events must be a non-empty array");

  const unsupportedResponse = await fetch(
    `${baseUrl}/api/ai-investigator/questions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "unknown", sourceId: "x" }),
    },
  );
  const unsupportedBody = await unsupportedResponse.json();

  assert.equal(unsupportedResponse.status, 400);
  assert.equal(unsupportedBody.message, "Unsupported AI investigation source");

  const blankQuestionResponse = await fetch(
    `${baseUrl}/api/ai-investigator/ask`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType: "incident",
        sourceId: "123e4567-e89b-42d3-a456-426614174000",
        question: " ",
      }),
    },
  );
  const blankQuestionBody = await blankQuestionResponse.json();

  assert.equal(blankQuestionResponse.status, 400);
  assert.equal(blankQuestionBody.message, "question must be a non-empty string");
});
