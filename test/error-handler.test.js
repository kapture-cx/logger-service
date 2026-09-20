import assert from "node:assert/strict";
import { test } from "node:test";
import errorHandling from "../src/middlewares/errorHandler.js";

function createResponse() {
  return {
    statusCode: 0,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("exposes intentional AI provider errors to the frontend", () => {
  const error = new Error("AI service rate limit exceeded");
  error.status = 429;
  error.expose = true;
  error.details = "Workspace is configured for 0 requests per minute";
  const response = createResponse();

  errorHandling(error, {}, response, () => {});

  assert.equal(response.statusCode, 429);
  assert.equal(response.body.message, error.message);
  assert.equal(response.body.error, error.details);
});

test("continues hiding unexpected server errors", () => {
  const error = new Error("database password leaked here");
  error.status = 503;
  const response = createResponse();

  errorHandling(error, {}, response, () => {});

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.message, "Something went wrong");
});
