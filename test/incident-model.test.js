import assert from "node:assert/strict";
import { mock, test } from "node:test";
import pool from "../src/config/db.js";
import {
  appendIncidentChunk,
  completeIncident,
  createIncident,
  createLiveSession,
  deleteAbandonedIncidents,
  deleteIncident,
  getIncident,
  getIncidentInvestigationEvidence,
  getIncidents,
  getLiveSessionInvestigationEvidence,
} from "../src/models/useModel.js";

const incidentId = "123e4567-e89b-42d3-a456-426614174000";

test("creates a recording incident with a server-generated UUID", async () => {
  const query = mock.method(pool, "query", async (_sql, values) => ({
    rows: [{ id: values[0], status: "recording" }],
  }));

  try {
    const incident = await createIncident({
      app: "kapturecrm-ui",
      startedAt: "2026-09-18T10:00:00.000Z",
      clientDetails: { userId: "qa-1" },
    });

    assert.match(incident.id, /^[0-9a-f-]{36}$/i);
    assert.equal(incident.status, "recording");
    assert.equal(query.mock.calls[0].arguments[1][1], "kapturecrm-ui");
  } finally {
    query.mock.restore();
  }
});

test("appends sequential replay chunks and accepts a retried sequence", async () => {
  const query = mock.method(pool, "query", async () => ({
    rows: [{ id: incidentId, lastSequence: 0 }],
  }));

  try {
    const result = await appendIncidentChunk(incidentId, {
      sequence: 0,
      events: [{ type: 1, timestamp: 1 }],
    });

    assert.equal(result.lastSequence, 0);
    assert.equal(query.mock.callCount(), 1);
  } finally {
    query.mock.restore();
  }
});

test("rejects an out-of-order replay chunk", async () => {
  const query = mock.method(pool, "query", async (_sql, values) =>
    values?.length === 3
      ? { rows: [] }
      : { rows: [{ status: "recording", last_sequence: 0 }] },
  );

  try {
    await assert.rejects(
      appendIncidentChunk(incidentId, { sequence: 2, events: [{ type: 1 }] }),
      (error) => error.status === 409 && error.message === "Expected sequence 1",
    );
  } finally {
    query.mock.restore();
  }
});

test("validates incident chunks and completion payloads before querying", async () => {
  await assert.rejects(
    appendIncidentChunk("not-a-uuid", { sequence: 0, events: [{}] }),
    /valid UUID/,
  );
  await assert.rejects(
    appendIncidentChunk(incidentId, { sequence: 0, events: [] }),
    /non-empty array/,
  );
  await assert.rejects(
    appendIncidentChunk(incidentId, { sequence: 0, events: ["invalid"] }),
    /JSON object/,
  );
  await assert.rejects(
    completeIncident(incidentId, {
      title: " ",
      endedAt: "2026-09-18T10:01:00.000Z",
      durationMs: 60000,
    }),
    /title must be a non-empty string/,
  );
});

test("completes and deletes incidents", async () => {
  const query = mock.method(pool, "query", async (sql) => ({
    rows: sql.startsWith("DELETE")
      ? [{ id: incidentId }]
      : [{ id: incidentId, status: "ready", title: "Broken form" }],
  }));

  try {
    const completed = await completeIncident(incidentId, {
      title: "Broken form",
      endedAt: "2026-09-18T10:01:00.000Z",
      durationMs: 60000,
    });
    const deleted = await deleteIncident(incidentId);

    assert.equal(completed.status, "ready");
    assert.equal(deleted.id, incidentId);
  } finally {
    query.mock.restore();
  }
});

test("deletes abandoned recording incidents using updated_at", async () => {
  const query = mock.method(pool, "query", async () => ({ rowCount: 3 }));

  try {
    const deletedCount = await deleteAbandonedIncidents();
    const sql = query.mock.calls[0].arguments[0];

    assert.equal(deletedCount, 3);
    assert.match(sql, /status = 'recording'/);
    assert.match(sql, /updated_at/);
    assert.match(sql, /INTERVAL '30 minutes'/);
    assert.doesNotMatch(sql, /created_at/);
  } finally {
    query.mock.restore();
  }
});

test("retrieves replay events with correlated technical logs", async () => {
  const query = mock.method(pool, "query", async (sql) =>
    sql.includes("FROM public.incidents")
      ? { rows: [{ id: incidentId, replayEvents: [{ type: 1 }] }] }
      : {
          rows: [
            {
              event: { type: "javascript-error", incidentId },
              app: "kapturecrm-ui",
              client_details: { userId: "qa-1" },
            },
          ],
        },
  );

  try {
    const incident = await getIncident(incidentId);

    assert.deepEqual(incident.replayEvents, [{ type: 1 }]);
    assert.equal(incident.logs[0].incidentId, incidentId);
    assert.equal(incident.logs[0].clientDetails.userId, "qa-1");
  } finally {
    query.mock.restore();
  }
});

test("loads a ready incident as generic AI evidence without replay events", async () => {
  const query = mock.method(pool, "query", async (sql) =>
    sql.includes("FROM public.incidents")
      ? {
          rows: [{
            id: incidentId,
            app: "kapturecrm-ui",
            status: "ready",
            title: "Broken form",
            expectedBehavior: "Customer is created",
            actualBehavior: "Request failed",
            clientDetails: { userId: "qa-1" },
          }],
        }
      : {
          rows: [{
            event: { type: "api-request", statusCode: 500 },
            app: "kapturecrm-ui",
            client_details: { userId: "qa-1" },
          }],
        },
  );

  try {
    const evidence = await getIncidentInvestigationEvidence(incidentId);
    const incidentSql = query.mock.calls[0].arguments[0];

    assert.equal(evidence.sourceType, "incident");
    assert.equal(evidence.sourceId, incidentId);
    assert.equal(evidence.metadata.expectedBehavior, "Customer is created");
    assert.equal(evidence.events[0].evidenceId, "E1");
    assert.equal(evidence.events[0].statusCode, 500);
    assert.doesNotMatch(incidentSql, /replay_events/i);
  } finally {
    query.mock.restore();
  }
});

test("rejects incomplete incidents and ready incidents without logs for AI", async () => {
  const query = mock.method(pool, "query", async (sql) =>
    sql.includes("FROM public.incidents")
      ? { rows: [{ id: incidentId, status: "recording" }] }
      : { rows: [] },
  );

  try {
    await assert.rejects(
      getIncidentInvestigationEvidence(incidentId),
      (error) => error.status === 409,
    );

    query.mock.mockImplementation(async (sql) =>
      sql.includes("FROM public.incidents")
        ? { rows: [{ id: incidentId, status: "ready" }] }
        : { rows: [] },
    );

    await assert.rejects(
      getIncidentInvestigationEvidence(incidentId),
      (error) => error.status === 422,
    );
  } finally {
    query.mock.restore();
  }
});

test("creates a completed live session while preserving event order", async () => {
  const query = mock.method(pool, "query", async (_sql, values) => ({
    rows: [{ id: values[0] }],
  }));
  const events = [
    { type: "user-click", timestamp: "2026-09-20T10:00:01.000Z" },
    { type: "api-request", timestamp: "2026-09-20T10:00:02.000Z" },
  ];

  try {
    const session = await createLiveSession({
      clientKey: "democrm",
      userId: "120040",
      agent: "Ankit Tiwari",
      applications: ["kapturecrm-ui"],
      events,
      startedAt: "2026-09-20T10:00:00.000Z",
      endedAt: "2026-09-20T10:01:00.000Z",
    });
    const values = query.mock.calls[0].arguments[1];

    assert.match(session.id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(JSON.parse(values[7]), events);
  } finally {
    query.mock.restore();
  }
});

test("validates completed live sessions before querying", async () => {
  const valid = {
    clientKey: "democrm",
    userId: "120040",
    events: [{}],
    startedAt: "2026-09-20T10:00:00.000Z",
    endedAt: "2026-09-20T10:01:00.000Z",
  };

  await assert.rejects(createLiveSession({ ...valid, clientKey: " " }), /clientKey/);
  await assert.rejects(createLiveSession({ ...valid, userId: " " }), /userId/);
  await assert.rejects(createLiveSession({ ...valid, events: [] }), /between 1 and 300/);
  await assert.rejects(
    createLiveSession({ ...valid, events: Array.from({ length: 301 }, () => ({})) }),
    /between 1 and 300/,
  );
  await assert.rejects(createLiveSession({ ...valid, events: ["invalid"] }), /JSON object/);
  await assert.rejects(createLiveSession({ ...valid, startedAt: "invalid" }), /startedAt/);
  await assert.rejects(
    createLiveSession({
      ...valid,
      startedAt: "2026-09-20T10:02:00.000Z",
      endedAt: "2026-09-20T10:01:00.000Z",
    }),
    /endedAt must be after or equal to startedAt/,
  );
});

test("loads a completed live session as generic chronological AI evidence", async () => {
  const query = mock.method(pool, "query", async () => ({
    rows: [{
      id: incidentId,
      clientKey: "democrm",
      userId: "120040",
      agent: "Ankit Tiwari",
      applications: ["kapturecrm-ui"],
      startedAt: "2026-09-20T10:00:00.000Z",
      endedAt: "2026-09-20T10:01:00.000Z",
      events: [
        { type: "user-click", label: "Save" },
        { type: "api-request", statusCode: 500 },
      ],
    }],
  }));

  try {
    const evidence = await getLiveSessionInvestigationEvidence(incidentId);

    assert.equal(evidence.sourceType, "live-session");
    assert.equal(evidence.title, "Live monitoring: Ankit Tiwari");
    assert.equal(evidence.metadata.eventCount, 2);
    assert.equal(evidence.events[0].evidenceId, "E1");
    assert.equal(evidence.events[0].label, "Save");
    assert.equal(evidence.events[1].evidenceId, "E2");
  } finally {
    query.mock.restore();
  }
});

test("rejects missing or empty live sessions for AI investigation", async () => {
  const query = mock.method(pool, "query", async () => ({ rows: [] }));

  try {
    await assert.rejects(
      getLiveSessionInvestigationEvidence(incidentId),
      (error) => error.status === 404,
    );
    query.mock.mockImplementation(async () => ({
      rows: [{ id: incidentId, events: [] }],
    }));
    await assert.rejects(
      getLiveSessionInvestigationEvidence(incidentId),
      (error) => error.status === 422,
    );
  } finally {
    query.mock.restore();
  }
});

test("lists lightweight ready incident summaries by default", async () => {
  const rows = [
    {
      id: incidentId,
      app: "kapturecrm-ui",
      status: "ready",
      title: "Customer form failed",
    },
  ];
  const query = mock.method(pool, "query", async () => ({ rows }));

  try {
    const incidents = await getIncidents({
      app: "kapturecrm-ui",
      cmId: "8400",
    });

    assert.deepEqual(incidents, rows);
    assert.deepEqual(query.mock.calls[0].arguments[1], [
      "kapturecrm-ui",
      "8400",
    ]);
    assert.doesNotMatch(query.mock.calls[0].arguments[0], /replay_events/i);
    assert.match(query.mock.calls[0].arguments[0], /status = 'ready'/);
    assert.match(query.mock.calls[0].arguments[0], /client_details->>'cmId' = \$2/);
    assert.match(query.mock.calls[0].arguments[0], /ORDER BY created_at DESC/);
    assert.match(query.mock.calls[0].arguments[0], /LIMIT 50/);
  } finally {
    query.mock.restore();
  }
});

test("lists all ready incidents for an app and returns an empty array", async () => {
  const query = mock.method(pool, "query", async () => ({ rows: [] }));

  try {
    const incidents = await getIncidents({ app: "kapturecrm-ui" });

    assert.deepEqual(incidents, []);
    assert.deepEqual(query.mock.calls[0].arguments[1], ["kapturecrm-ui"]);
    assert.doesNotMatch(query.mock.calls[0].arguments[0], /client_details->>'cmId'/);
  } finally {
    query.mock.restore();
  }
});

test("validates incident list filters before querying", async () => {
  await assert.rejects(getIncidents(), /app must be a non-empty string/);
  await assert.rejects(
    getIncidents({ app: " ", cmId: "8400" }),
    /app must be a non-empty string/,
  );
  await assert.rejects(
    getIncidents({ app: "kapturecrm-ui", cmId: " " }),
    /cmId must be a non-empty string/,
  );
});
