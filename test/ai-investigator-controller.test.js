import assert from "node:assert/strict";
import { mock, test } from "node:test";
import pool from "../src/config/db.js";
import {
  askAiInvestigator,
  generateAiInvestigationQuestions,
  saveLiveSession,
} from "../src/controller/userController.js";

const incidentId = "123e4567-e89b-42d3-a456-426614174000";

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

function mockIncidentQueries() {
  return mock.method(pool, "query", async (sql) =>
    sql.includes("FROM public.incidents")
      ? {
          rows: [{
            id: incidentId,
            app: "kapturecrm-ui",
            status: "ready",
            title: "Broken form",
          }],
        }
      : {
          rows: [{
            event: { type: "api-request", statusCode: 500 },
            app: "kapturecrm-ui",
            client_details: {},
          }],
        },
  );
}

function mockClaudeFetch(output) {
  return mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: JSON.stringify(output) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

test("completed incidents work through both AI investigator controllers", async () => {
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const query = mockIncidentQueries();
  const questions = Array.from({ length: 10 }, (_, index) => `Question ${index + 1}?`);
  let claudeFetch = mockClaudeFetch({ questions });

  try {
    const questionResponse = createResponse();
    await generateAiInvestigationQuestions(
      { body: { sourceType: "incident", sourceId: incidentId } },
      questionResponse,
      (error) => { throw error; },
    );

    assert.equal(questionResponse.statusCode, 200);
    assert.equal(questionResponse.body.data.sourceType, "incident");
    assert.equal(questionResponse.body.data.sourceId, incidentId);
    assert.deepEqual(questionResponse.body.data.questions, questions);

    claudeFetch.mock.restore();
    claudeFetch = mockClaudeFetch({
      answer: "The request failed.",
      likelyCause: "The backend returned HTTP 500.",
      evidence: [{ evidenceId: "E1", summary: "The request returned 500." }],
      nextSteps: ["Inspect the backend trace."],
    });

    const answerResponse = createResponse();
    await askAiInvestigator(
      {
        body: {
          sourceType: "incident",
          sourceId: incidentId,
          question: "Why did it fail?",
        },
      },
      answerResponse,
      (error) => { throw error; },
    );

    assert.equal(answerResponse.statusCode, 200);
    assert.equal(answerResponse.body.data.evidence[0].evidenceId, "E1");
    assert.deepEqual(answerResponse.body.data.citations, []);
  } finally {
    claudeFetch.mock.restore();
    query.mock.restore();
    if (previousApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousApiKey;
    }
  }
});

test("completed live sessions save and work through both AI investigator controllers", async () => {
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const query = mock.method(pool, "query", async (sql, values) => {
    if (sql.includes("INSERT INTO public.live_sessions")) {
      return { rows: [{ id: values[0] }] };
    }

    return {
      rows: [{
        id: incidentId,
        clientKey: "democrm",
        userId: "120040",
        agent: "Ankit Tiwari",
        applications: ["kapturecrm-ui"],
        events: [{ type: "api-request", statusCode: 500 }],
      }],
    };
  });
  const questions = Array.from({ length: 10 }, (_, index) => `Live question ${index + 1}?`);
  let claudeFetch = mockClaudeFetch({ questions });

  try {
    const saveResponse = createResponse();
    await saveLiveSession({
      body: {
        clientKey: "democrm",
        userId: "120040",
        events: [{ type: "api-request", statusCode: 500 }],
        startedAt: "2026-09-20T10:00:00.000Z",
        endedAt: "2026-09-20T10:01:00.000Z",
      },
    }, saveResponse, (error) => { throw error; });
    assert.equal(saveResponse.statusCode, 201);
    assert.match(saveResponse.body.data.id, /^[0-9a-f-]{36}$/i);

    const questionResponse = createResponse();
    await generateAiInvestigationQuestions(
      { body: { sourceType: "live-session", sourceId: incidentId } },
      questionResponse,
      (error) => { throw error; },
    );
    assert.equal(questionResponse.body.data.sourceType, "live-session");
    assert.equal(questionResponse.body.data.sourceId, incidentId);
    assert.deepEqual(questionResponse.body.data.questions, questions);

    claudeFetch.mock.restore();
    claudeFetch = mockClaudeFetch({
      answer: "The live request failed.",
      likelyCause: "The backend returned HTTP 500.",
      evidence: [{ evidenceId: "E1", summary: "The request returned 500." }],
      nextSteps: ["Inspect the backend trace."],
    });
    const answerResponse = createResponse();
    await askAiInvestigator({
      body: {
        sourceType: "live-session",
        sourceId: incidentId,
        question: "Why did it fail?",
      },
    }, answerResponse, (error) => { throw error; });

    assert.equal(answerResponse.statusCode, 200);
    assert.equal(answerResponse.body.data.evidence[0].evidenceId, "E1");
    assert.deepEqual(answerResponse.body.data.citations, []);
  } finally {
    claudeFetch.mock.restore();
    query.mock.restore();
    if (previousApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousApiKey;
    }
  }
});
