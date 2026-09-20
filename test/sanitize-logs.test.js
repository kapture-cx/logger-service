import assert from "node:assert/strict";
import { test } from "node:test";
import sanitizeLogs from "../src/middlewares/sanitizeLogs.js";

test("removes PostgreSQL-incompatible null characters from live session data", () => {
  const request = {
    body: {
      events: [{ message: "before\u0000after", nested: { value: "a\u0001b" } }],
    },
  };

  sanitizeLogs(request, null, () => {});

  assert.equal(request.body.events[0].message, "beforeafter");
  assert.equal(request.body.events[0].nested.value, "ab");
});
