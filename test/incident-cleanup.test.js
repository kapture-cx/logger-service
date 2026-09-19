import assert from "node:assert/strict";
import { mock, test } from "node:test";
import pool from "../src/config/db.js";
import { runIncidentCleanup } from "../src/incidentCleanup.js";

test("cleanup failures are logged without being thrown", async () => {
  const databaseError = new Error("database unavailable");
  const query = mock.method(pool, "query", async () => {
    throw databaseError;
  });
  const logError = mock.method(console, "error", () => {});

  try {
    assert.equal(await runIncidentCleanup(), 0);
    assert.equal(logError.mock.callCount(), 1);
    assert.equal(
      logError.mock.calls[0].arguments[0],
      "Failed to clean up abandoned incident recordings",
    );
    assert.equal(logError.mock.calls[0].arguments[1], databaseError);
  } finally {
    logError.mock.restore();
    query.mock.restore();
  }
});
