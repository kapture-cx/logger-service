import assert from "node:assert/strict";
import { test } from "node:test";
import { sendDetectionEmail } from "../src/detectionEmail.js";

const detection = {
  app: "kapturecrm-ui",
  cmId: "8400",
  customerName: "democrm",
  severity: "high",
  title: "High failure rate",
  summary: "3 of 5 requests failed.",
  affectedSessions: 2,
  firstSeenAt: "2026-09-21T10:00:00.000Z",
  lastSeenAt: "2026-09-21T10:01:00.000Z",
};

test("skips Gmail safely when configuration is missing", async () => {
  assert.equal(await sendDetectionEmail(detection, {}), false);
});

test("sends a branded HTML Gmail notification with a plain-text fallback", async () => {
  let transportOptions;
  let message;
  const sent = await sendDetectionEmail(
    detection,
    {
      GMAIL_USER: "alerts@gmail.com",
      GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
      ALERT_EMAIL_RECIPIENTS: "qa@example.com, admin@example.com",
    },
    (options) => {
      transportOptions = options;
      return { sendMail: async (nextMessage) => { message = nextMessage; } };
    },
  );

  assert.equal(sent, true);
  assert.equal(transportOptions.auth.pass, "abcdefghijklmnop");
  assert.deepEqual(message.to, ["qa@example.com", "admin@example.com"]);
  assert.match(message.subject, /^\[Kapture Trace\]\[HIGH\]/);
  assert.match(message.text, /Customer name: democrm/);
  assert.match(message.text, /Customer ID: 8400/);
  assert.match(message.html, /Kapture Trace/);
  assert.match(message.html, /3 of 5 requests failed\./);
  assert.match(message.html, /Affected sessions/);
  assert.match(message.html, /Customer name/);
  assert.match(message.html, /democrm/);
});
