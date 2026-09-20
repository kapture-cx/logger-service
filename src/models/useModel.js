import { randomUUID } from "node:crypto";
import pool from "../config/db.js";

const ISO_DATE_TIME_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function validateApp(app) {
  if (typeof app !== "string" || app.trim() === "") {
    throw new TypeError("app must be a non-empty string");
  }

  return app.trim();
}

function validateOptionalFilter(value, name) {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function validateDateTime(value, name) {
  if (
    typeof value !== "string" ||
    !ISO_DATE_TIME_WITH_TIMEZONE.test(value.trim())
  ) {
    throw new TypeError(
      `${name} must be a valid ISO 8601 date-time with a timezone`,
    );
  }

  const timestamp = Date.parse(value.trim());

  if (Number.isNaN(timestamp)) {
    throw new TypeError(
      `${name} must be a valid ISO 8601 date-time with a timezone`,
    );
  }

  return new Date(timestamp);
}

function validateDateRange(startDate, endDate) {
  const hasStartDate = startDate !== undefined;
  const hasEndDate = endDate !== undefined;

  if (hasStartDate !== hasEndDate) {
    throw new TypeError("startDate and endDate must be provided together");
  }

  if (!hasStartDate) {
    return null;
  }

  const validatedStartDate = validateDateTime(startDate, "startDate");
  const validatedEndDate = validateDateTime(endDate, "endDate");

  if (validatedStartDate > validatedEndDate) {
    throw new TypeError("startDate must be before or equal to endDate");
  }

  return {
    startDate: validatedStartDate.toISOString(),
    endDate: validatedEndDate.toISOString(),
  };
}

function validateClientDetails(clientDetails) {
  if (clientDetails === undefined) {
    return null;
  }

  if (
    clientDetails === null ||
    typeof clientDetails !== "object" ||
    Array.isArray(clientDetails)
  ) {
    throw new TypeError("clientDetails must be a JSON object");
  }

  return clientDetails;
}

function validateFilterPayload(payload) {
  if (payload === undefined) {
    return {};
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Filter payload must be a JSON object");
  }

  return payload;
}

function mapExpandedEvents(rows) {
  return rows.map(({ event, app, client_details: clientDetails }) => ({
    ...event,
    app,
    clientDetails,
  }));
}

export const getAllLogs = async () => {
  const result = await pool.query("SELECT * FROM logs");
  return result.rows;
};

export const addLogs = async ({ app, events, clientDetails } = {}) => {
  const validatedApp = validateApp(app);
  const validatedClientDetails = validateClientDetails(clientDetails);

  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }

  const result = await pool.query(
    `INSERT INTO logs (app, events, client_details)
     VALUES ($1, $2::jsonb, $3::jsonb)
     RETURNING id, app, events, client_details AS "clientDetails", created_at`,
    [
      validatedApp,
      JSON.stringify(events),
      validatedClientDetails === null
        ? null
        : JSON.stringify(validatedClientDetails),
    ],
  );

  return result.rows[0];
};

export const getLogsByFilters = async (payload) => {
  const { app, type, cmId, startDate, endDate } =
    validateFilterPayload(payload);
  const validatedApp = validateApp(app);
  const validatedType = validateOptionalFilter(type, "type");
  const validatedCmId = validateOptionalFilter(cmId, "cmId");
  const validatedDateRange = validateDateRange(startDate, endDate);
  const values = [validatedApp];
  const conditions = ["log.app = $1"];

  if (validatedType !== null) {
    const parameterPosition = values.push(validatedType);
    conditions.push(
      `log.events @> JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('type', $${parameterPosition}::text))`,
      `expanded.event->>'type' = $${parameterPosition}`,
    );
  }

  if (validatedCmId !== null) {
    const parameterPosition = values.push(validatedCmId);
    conditions.push(
      `log.client_details->>'cmId' = $${parameterPosition}`,
    );
  }

  if (validatedDateRange !== null) {
    const startDatePosition = values.push(validatedDateRange.startDate);
    const endDatePosition = values.push(validatedDateRange.endDate);
    conditions.push(
      `(CASE
         WHEN pg_input_is_valid(
           expanded.event->>'timestamp',
           'timestamp with time zone'
         )
         THEN (expanded.event->>'timestamp')::timestamptz
         WHEN expanded.event->>'type' = 'page-transition'
           AND pg_input_is_valid(
             expanded.event->>'leftAt',
             'timestamp with time zone'
           )
         THEN (expanded.event->>'leftAt')::timestamptz
         WHEN expanded.event->>'type' = 'page-transition'
           AND pg_input_is_valid(
             expanded.event->>'enteredAt',
             'timestamp with time zone'
           )
         THEN (expanded.event->>'enteredAt')::timestamptz
         ELSE NULL
       END) BETWEEN $${startDatePosition}::timestamptz
                AND $${endDatePosition}::timestamptz`,
    );
  }

  const result = await pool.query(
    `SELECT expanded.event, log.app, log.client_details
     FROM public.logs AS log
     CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(log.events)
       WITH ORDINALITY AS expanded(event, event_order)
     WHERE ${conditions.join("\n       AND ")}
     ORDER BY log.created_at DESC, log.id DESC, expanded.event_order ASC`,
    values,
  );

  return mapExpandedEvents(result.rows);
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateIncidentId(id) {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new TypeError("incident id must be a valid UUID");
  }

  return id;
}

export const createIncident = async ({
  app,
  startedAt,
  sessionId,
  tabId,
  pageViewId,
  clientDetails,
} = {}) => {
  const id = randomUUID();
  const validatedApp = validateApp(app);
  const validatedStartedAt = validateDateTime(startedAt, "startedAt");
  const validatedClientDetails = validateClientDetails(clientDetails);
  const result = await pool.query(
    `INSERT INTO public.incidents (
       id, app, session_id, tab_id, page_view_id, client_details, started_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id, app, status, started_at AS "startedAt", created_at AS "createdAt"`,
    [
      id,
      validatedApp,
      sessionId || null,
      tabId || null,
      pageViewId || null,
      validatedClientDetails === null
        ? null
        : JSON.stringify(validatedClientDetails),
      validatedStartedAt.toISOString(),
    ],
  );

  return result.rows[0];
};

export const appendIncidentChunk = async (id, { sequence, events } = {}) => {
  const validatedId = validateIncidentId(id);

  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new TypeError("sequence must be a non-negative integer");
  }

  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError("events must be a non-empty array");
  }

  if (
    events.some(
      (event) => !event || typeof event !== "object" || Array.isArray(event),
    )
  ) {
    throw new TypeError("each replay event must be a JSON object");
  }

  const serializedEvents = JSON.stringify(events);

  const result = await pool.query(
    `UPDATE public.incidents
     SET replay_events = CASE
           WHEN $2 = last_sequence + 1 THEN replay_events || $3::jsonb
           ELSE replay_events
         END,
         last_sequence = GREATEST(last_sequence, $2),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND status = 'recording'
       AND $2 <= last_sequence + 1
     RETURNING id, last_sequence AS "lastSequence"`,
    [validatedId, sequence, serializedEvents],
  );

  if (result.rows[0]) {
    return result.rows[0];
  }

  const incident = await pool.query(
    "SELECT status, last_sequence FROM public.incidents WHERE id = $1",
    [validatedId],
  );

  if (!incident.rows[0]) {
    const error = new Error("Incident not found");
    error.status = 404;
    throw error;
  }

  const error = new Error(
    incident.rows[0].status !== "recording"
      ? "Incident is already complete"
      : `Expected sequence ${incident.rows[0].last_sequence + 1}`,
  );
  error.status = 409;
  throw error;
};

export const completeIncident = async (
  id,
  { title, expectedBehavior, actualBehavior, endedAt, durationMs } = {},
) => {
  const validatedId = validateIncidentId(id);

  if (typeof title !== "string" || !title.trim()) {
    throw new TypeError("title must be a non-empty string");
  }

  const validatedEndedAt = validateDateTime(endedAt, "endedAt");

  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 300000) {
    throw new TypeError("durationMs must be an integer between 0 and 300000");
  }

  const result = await pool.query(
    `UPDATE public.incidents
     SET status = 'ready',
         title = $2,
         expected_behavior = $3,
         actual_behavior = $4,
         ended_at = $5,
         duration_ms = $6,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND status = 'recording'
       AND JSONB_ARRAY_LENGTH(replay_events) > 0
     RETURNING id, app, status, title,
       expected_behavior AS "expectedBehavior",
       actual_behavior AS "actualBehavior",
       started_at AS "startedAt", ended_at AS "endedAt",
       duration_ms AS "durationMs", created_at AS "createdAt"`,
    [
      validatedId,
      title.trim(),
      typeof expectedBehavior === "string" ? expectedBehavior.trim() || null : null,
      typeof actualBehavior === "string" ? actualBehavior.trim() || null : null,
      validatedEndedAt.toISOString(),
      durationMs,
    ],
  );

  if (!result.rows[0]) {
    const error = new Error("Recording incident was not found or has no replay events");
    error.status = 409;
    throw error;
  }

  return result.rows[0];
};

export const deleteIncident = async (id) => {
  const result = await pool.query(
    "DELETE FROM public.incidents WHERE id = $1 RETURNING id",
    [validateIncidentId(id)],
  );

  if (!result.rows[0]) {
    const error = new Error("Incident not found");
    error.status = 404;
    throw error;
  }

  return result.rows[0];
};

export const deleteAbandonedIncidents = async () => {
  const result = await pool.query(
    `DELETE FROM public.incidents
     WHERE status = 'recording'
       AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'`,
  );

  return result.rowCount || 0;
};

export const getIncidents = async ({ app, cmId } = {}) => {
  const validatedApp = validateApp(app);
  const validatedCmId = validateOptionalFilter(cmId, "cmId");
  const values = [validatedApp];
  const cmIdCondition = validatedCmId === null
    ? ""
    : `\n       AND client_details->>'cmId' = $${values.push(validatedCmId)}`;

  const result = await pool.query(
    `SELECT id, app, status, title,
       client_details AS "clientDetails",
       started_at AS "startedAt", ended_at AS "endedAt",
       duration_ms AS "durationMs", created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM public.incidents
     WHERE app = $1
       AND status = 'ready'${cmIdCondition}
     ORDER BY created_at DESC
     LIMIT 50`,
    values,
  );

  return result.rows;
};

export const getIncident = async (id) => {
  const validatedId = validateIncidentId(id);
  const [incidentResult, logsResult] = await Promise.all([
    pool.query(
      `SELECT id, app, status, title,
         expected_behavior AS "expectedBehavior",
         actual_behavior AS "actualBehavior",
         session_id AS "sessionId", tab_id AS "tabId",
         page_view_id AS "pageViewId", client_details AS "clientDetails",
         replay_events AS "replayEvents", last_sequence AS "lastSequence",
         started_at AS "startedAt", ended_at AS "endedAt",
         duration_ms AS "durationMs", created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM public.incidents
       WHERE id = $1`,
      [validatedId],
    ),
    pool.query(
      `SELECT expanded.event, log.app, log.client_details
       FROM public.logs AS log
       CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(log.events)
         WITH ORDINALITY AS expanded(event, event_order)
       WHERE expanded.event->>'incidentId' = $1
       ORDER BY expanded.event->>'timestamp' ASC NULLS LAST,
         log.created_at ASC, expanded.event_order ASC`,
      [validatedId],
    ),
  ]);

  if (!incidentResult.rows[0]) {
    const error = new Error("Incident not found");
    error.status = 404;
    throw error;
  }

  return {
    ...incidentResult.rows[0],
    logs: mapExpandedEvents(logsResult.rows),
  };
};

export const getIncidentInvestigationEvidence = async (id) => {
  const validatedId = validateIncidentId(id);
  const [incidentResult, logsResult] = await Promise.all([
    pool.query(
      `SELECT id, app, status, title,
         expected_behavior AS "expectedBehavior",
         actual_behavior AS "actualBehavior",
         session_id AS "sessionId", tab_id AS "tabId",
         page_view_id AS "pageViewId", client_details AS "clientDetails",
         started_at AS "startedAt", ended_at AS "endedAt",
         duration_ms AS "durationMs"
       FROM public.incidents
       WHERE id = $1`,
      [validatedId],
    ),
    pool.query(
      `SELECT expanded.event, log.app, log.client_details
       FROM public.logs AS log
       CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(log.events)
         WITH ORDINALITY AS expanded(event, event_order)
       WHERE expanded.event->>'incidentId' = $1
       ORDER BY expanded.event->>'timestamp' ASC NULLS LAST,
         log.created_at ASC, expanded.event_order ASC`,
      [validatedId],
    ),
  ]);
  const incident = incidentResult.rows[0];

  if (!incident) {
    const error = new Error("Incident not found");
    error.status = 404;
    throw error;
  }

  if (incident.status !== "ready") {
    const error = new Error("Incident is not ready for AI investigation");
    error.status = 409;
    throw error;
  }

  const logs = mapExpandedEvents(logsResult.rows);

  if (logs.length === 0) {
    const error = new Error("Incident has no correlated logs");
    error.status = 422;
    throw error;
  }

  return {
    sourceType: "incident",
    sourceId: incident.id,
    title: incident.title,
    startedAt: incident.startedAt,
    endedAt: incident.endedAt,
    metadata: {
      app: incident.app,
      expectedBehavior: incident.expectedBehavior,
      actualBehavior: incident.actualBehavior,
      sessionId: incident.sessionId,
      tabId: incident.tabId,
      pageViewId: incident.pageViewId,
      clientDetails: incident.clientDetails,
      durationMs: incident.durationMs,
    },
    events: logs.map((event, index) => ({
      ...event,
      evidenceId: `E${index + 1}`,
    })),
  };
};
