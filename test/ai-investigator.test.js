import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerInvestigationQuestion,
  buildInvestigationContext,
  generateInvestigationQuestions,
} from "../src/aiInvestigator.js";
import { loadInvestigationEvidence } from "../src/investigationEvidence.js";

const evidence = {
  sourceType: "incident",
  sourceId: "123e4567-e89b-42d3-a456-426614174000",
  title: "Customer form failed",
  metadata: { app: "kapturecrm-ui" },
  events: [
    {
      evidenceId: "E1",
      type: "api-request",
      status: "error",
      statusCode: 500,
      url: "/api/customers",
    },
  ],
};

test("builds a bounded context that prioritizes failures and keeps chronology", () => {
  const events = Array.from({ length: 20 }, (_, index) => ({
    evidenceId: `E${index + 1}`,
    type: index === 18
      ? "javascript-error"
      : index === 14
        ? "user-click"
        : "console",
    level: "log",
    message: "x".repeat(9000),
  }));
  const result = buildInvestigationContext({ ...evidence, events });

  assert.ok(result.context.length <= 100000);
  assert.match(result.context, /"evidenceId":"E19"/);
  assert.match(result.context, /"evidenceId":"E20"/);
  assert.match(result.context, /"evidenceId":"E15"/);
  assert.ok(result.context.indexOf('"E19"') < result.context.indexOf('"E20"'));
});

test("generates exactly ten unique questions with structured output", async () => {
  const questions = Array.from({ length: 10 }, (_, index) => `Question ${index + 1}?`);
  let request;
  const client = {
    messages: {
      create: async (body) => {
        request = body;
        return { content: [{ type: "text", text: JSON.stringify({ questions }) }] };
      },
    },
  };

  assert.deepEqual(
    await generateInvestigationQuestions(evidence, client),
    questions,
  );
  assert.equal(request.model, process.env.ANTHROPIC_MODEL || "claude-opus-5");
  assert.equal(request.system[1].cache_control.ttl, "5m");
  assert.equal(request.output_config.format.type, "json_schema");
});

test("returns grounded answers and rejects unknown evidence references", async () => {
  const answer = {
    answer: "The request failed.",
    likelyCause: "The backend returned HTTP 500.",
    evidence: [{ evidenceId: "E1", summary: "The request returned 500." }],
    nextSteps: ["Inspect the backend trace."],
  };
  const client = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(answer) }],
      }),
    },
  };

  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why did it fail?", client),
    answer,
  );

  answer.evidence[0].evidenceId = "E999";
  await assert.rejects(
    answerInvestigationQuestion(evidence, "Why did it fail?", client),
    (error) => error.status === 502 && /invalid investigation answer/.test(error.message),
  );
});

test("maps Claude rate limits and timeouts to API errors", async () => {
  const rateLimitMessage = "Workspace is configured for 0 requests per minute";
  const rateLimitedClient = {
    messages: {
      create: async () => {
        throw {
          status: 429,
          error: { error: { message: rateLimitMessage } },
        };
      },
    },
  };
  const timeoutClient = {
    messages: {
      create: async () => {
        const error = new Error("timeout");
        error.name = "APIConnectionTimeoutError";
        throw error;
      },
    },
  };

  await assert.rejects(
    generateInvestigationQuestions(evidence, rateLimitedClient),
    (error) =>
      error.status === 429 &&
      error.message === "AI service rate limit exceeded" &&
      error.details === rateLimitMessage &&
      error.expose === true,
  );
  await assert.rejects(
    generateInvestigationQuestions(evidence, timeoutClient),
    (error) => error.status === 504,
  );
});

test("requires server-side Anthropic configuration", async () => {
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    await assert.rejects(
      generateInvestigationQuestions(evidence),
      (error) =>
        error.status === 503 &&
        error.message === "ANTHROPIC_API_KEY is not configured",
    );
  } finally {
    if (previousApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = previousApiKey;
    }
  }
});

test("rejects unsupported investigation sources before accessing storage", () => {
  assert.throws(
    () => loadInvestigationEvidence({ sourceType: "unknown", sourceId: "x" }),
    /Unsupported AI investigation source/,
  );
});
