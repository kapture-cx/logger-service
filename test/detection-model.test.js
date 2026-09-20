import assert from "node:assert/strict";
import { mock, test } from "node:test";
import pool from "../src/config/db.js";
import {
  getDetections,
  getRecentDetectionEvents,
  markDetectionEmailed,
  upsertDetection,
} from "../src/models/useModel.js";

test("loads recent events with application and client details", async () => {
  const query = mock.method(pool, "query", async () => ({
    rows: [{
      event: { type: "javascript-error" },
      app: "kapturecrm-ui",
      client_details: { cmId: 8400 },
    }],
  }));

  try {
    const events = await getRecentDetectionEvents();
    assert.equal(events[0].app, "kapturecrm-ui");
    assert.equal(events[0].clientDetails.cmId, 8400);
    assert.match(query.mock.calls[0].arguments[0], /INTERVAL '5 minutes'/);
  } finally {
    query.mock.restore();
  }
});

test("upserts a detection by fingerprint and preserves compact evidence", async () => {
  const query = mock.method(pool, "query", async (_sql, values) => ({
    rows: [{ id: values[0], severity: values[6], evidence: JSON.parse(values[11]) }],
  }));

  try {
    const result = await upsertDetection({
      app: "kapturecrm-ui",
      cmId: "8400",
      customerName: "democrm",
      fingerprint: "fingerprint",
      type: "api-failure",
      severity: "high",
      title: "API failed",
      summary: "3 requests failed",
      occurrenceCount: 3,
      affectedSessions: 2,
      evidence: [{ eventId: "event-1" }],
      firstSeenAt: "2026-09-21T10:00:00.000Z",
      lastSeenAt: "2026-09-21T10:01:00.000Z",
    });
    const sql = query.mock.calls[0].arguments[0];

    assert.match(result.id, /^[0-9a-f-]{36}$/i);
    assert.match(sql, /ON CONFLICT \(app, cm_id, fingerprint\)/);
    assert.deepEqual(result.evidence, [{ eventId: "event-1" }]);
  } finally {
    query.mock.restore();
  }
});

test("lists exact customer detections and returns their total", async () => {
  const query = mock.method(pool, "query", async () => ({
    rows: [{ id: "detection-1", total: "2" }, { id: "detection-2", total: "2" }],
  }));

  try {
    const result = await getDetections({ app: "kapturecrm-ui", cmId: "8400" });

    assert.equal(result.total, 2);
    assert.equal(result.detections.length, 2);
    assert.equal("total" in result.detections[0], false);
    assert.deepEqual(query.mock.calls[0].arguments[1], ["kapturecrm-ui", "8400"]);
  } finally {
    query.mock.restore();
  }
});

test("validates detection discovery and marks successful email delivery", async () => {
  await assert.rejects(getDetections(), /app/);
  await assert.rejects(
    getDetections({ app: "kapturecrm-ui", cmId: " " }),
    /cmId/,
  );

  const query = mock.method(pool, "query", async () => ({ rows: [] }));
  try {
    await markDetectionEmailed("detection-1");
    assert.deepEqual(query.mock.calls[0].arguments[1], ["detection-1"]);
  } finally {
    query.mock.restore();
  }
});
