import pool from "../config/db.js";

const createLogsTable = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.logs (
        id BIGSERIAL PRIMARY KEY,
        app TEXT NOT NULL,
        events JSONB NOT NULL,
        client_details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT logs_app_not_blank CHECK (BTRIM(app) <> ''),
        CONSTRAINT logs_events_is_array CHECK (JSONB_TYPEOF(events) = 'array'),
        CONSTRAINT logs_client_details_is_object CHECK (
          client_details IS NULL OR JSONB_TYPEOF(client_details) = 'object'
        )
      )
    `);

    // CREATE TABLE IF NOT EXISTS does not modify tables that already exist.
    // This keeps existing installations in sync while preserving old rows as NULL.
    await client.query(`
      ALTER TABLE public.logs
      ADD COLUMN IF NOT EXISTS client_details JSONB
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.logs'::regclass
            AND conname = 'logs_client_details_is_object'
        ) THEN
          ALTER TABLE public.logs
          ADD CONSTRAINT logs_client_details_is_object CHECK (
            client_details IS NULL OR JSONB_TYPEOF(client_details) = 'object'
          );
        END IF;
      END;
      $$
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS logs_app_idx
      ON public.logs (app)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS logs_events_gin_idx
      ON public.logs USING GIN (events JSONB_PATH_OPS)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS logs_app_cm_id_idx
      ON public.logs (app, (client_details->>'cmId'))
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.incidents (
        id UUID PRIMARY KEY,
        app TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'recording',
        title TEXT,
        expected_behavior TEXT,
        actual_behavior TEXT,
        session_id TEXT,
        tab_id TEXT,
        page_view_id TEXT,
        client_details JSONB,
        replay_events JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_sequence INTEGER NOT NULL DEFAULT -1,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ,
        duration_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT incidents_status_check CHECK (status IN ('recording', 'ready')),
        CONSTRAINT incidents_replay_events_array CHECK (
          JSONB_TYPEOF(replay_events) = 'array'
        ),
        CONSTRAINT incidents_client_details_object CHECK (
          client_details IS NULL OR JSONB_TYPEOF(client_details) = 'object'
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS incidents_app_status_created_idx
      ON public.incidents (app, status, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.live_sessions (
        id UUID PRIMARY KEY,
        client_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent TEXT,
        designation TEXT,
        host TEXT,
        applications JSONB NOT NULL DEFAULT '[]'::jsonb,
        events JSONB NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT live_sessions_client_key_not_blank CHECK (BTRIM(client_key) <> ''),
        CONSTRAINT live_sessions_user_id_not_blank CHECK (BTRIM(user_id) <> ''),
        CONSTRAINT live_sessions_applications_array CHECK (
          JSONB_TYPEOF(applications) = 'array'
        ),
        CONSTRAINT live_sessions_events_array CHECK (
          JSONB_TYPEOF(events) = 'array'
          AND JSONB_ARRAY_LENGTH(events) BETWEEN 1 AND 300
        ),
        CONSTRAINT live_sessions_time_order CHECK (ended_at >= started_at)
      )
    `);

    await client.query("COMMIT");
    console.log("Logs table is ready");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export default createLogsTable;
