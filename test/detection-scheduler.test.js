import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { runDetections } from "../src/detectionScheduler.js";

function failures() {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `event-${index}`,
    app: "kapturecrm-ui",
    clientDetails: { cmId: 8400 },
    sessionId: `session-${index}`,
    type: "api-request",
    method: "POST",
    url: "/api/customers",
    statusCode: 500,
    timestamp: "2026-09-21T10:00:00.000Z",
  }));
}

test("emails an unnotified high detection and marks it sent", async () => {
  const emailed = [];
  const marked = [];
  const count = await runDetections({
    loadEvents: async () => failures(),
    saveDetection: async (detection) => ({ ...detection, id: "detection-1", emailSentAt: null }),
    sendEmail: async (detection) => { emailed.push(detection); return true; },
    markEmailed: async (id) => marked.push(id),
  });

  assert.equal(count, 1);
  assert.equal(emailed.length, 1);
  assert.deepEqual(marked, ["detection-1"]);
});

test("does not resend an emailed detection or email medium detections", async () => {
  let sends = 0;
  const slowEvents = Array.from({ length: 3 }, (_, index) => ({
    ...failures()[index],
    statusCode: 200,
    duration: 500,
    url: "/api/orders",
  }));

  await runDetections({
    loadEvents: async () => [...failures(), ...slowEvents],
    saveDetection: async (detection) => ({
      ...detection,
      id: detection.type,
      emailSentAt: detection.type === "api-failure" ? new Date() : null,
    }),
    sendEmail: async () => { sends += 1; return true; },
    markEmailed: async () => {},
  });

  assert.equal(sends, 0);
});

test("keeps detections when email or the detector fails", async () => {
  const emailError = new Error("SMTP unavailable");
  const logError = mock.method(console, "error", () => {});
  let marked = false;

  try {
    assert.equal(await runDetections({
      loadEvents: async () => failures(),
      saveDetection: async (detection) => ({ ...detection, id: "detection-1" }),
      sendEmail: async () => { throw emailError; },
      markEmailed: async () => { marked = true; },
    }), 1);
    assert.equal(marked, false);

    assert.equal(await runDetections({
      loadEvents: async () => { throw new Error("database unavailable"); },
    }), 0);
    assert.equal(logError.mock.callCount(), 2);
  } finally {
    logError.mock.restore();
  }
});
