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
