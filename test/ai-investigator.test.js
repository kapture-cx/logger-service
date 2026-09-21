import assert from "node:assert/strict";
import { mock, test } from "node:test";
import aiInvestigatorDemoQuestions from "../src/data/aiInvestigatorDemoQuestions.js";
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
  startedAt: "2026-09-20T10:00:00.000Z",
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
const citationE1 = {
  evidenceId: "E1",
  eventIndex: 0,
  evidenceOffsetMs: null,
  evidenceTime: null,
  type: "api-request",
  timestamp: null,
};

test("provides the exact ten imported demo fallback questions", () => {
  assert.equal(aiInvestigatorDemoQuestions.length, 10);
  assert.match(aiInvestigatorDemoQuestions[0], /dcsedde.*dashboard\/249/);
  assert.match(aiInvestigatorDemoQuestions[9], /short session duration of 18 seconds/);
});

function getContextEvents(context) {
  const contents = context
    .split("<session_evidence>\n")[1]
    .split("\n</session_evidence>")[0];
  return contents ? contents.split("\n").map((event) => JSON.parse(event)) : [];
}

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

  assert.ok(result.context.length <= 40000);
  assert.equal(result.evidenceIds.has("E19"), true);
  assert.equal(result.evidenceIds.has("E20"), true);
  assert.equal(result.evidenceIds.has("E15"), true);
  assert.ok(result.context.indexOf("E19") < result.context.indexOf("E20"));
});

test("compacts failed API payloads without mutating diagnostic evidence", () => {
  const responseData = {
    records: Array.from({ length: 100 }, (_, index) => ({
      id: index,
      value: `record-${index}`,
    })),
    filler1: "x".repeat(200),
    filler2: "x".repeat(200),
    filler3: "x".repeat(200),
    message: "Customer already exists",
    errorCode: "DUPLICATE_CUSTOMER",
    validationErrors: {
      phone: "Phone number is already registered",
      password: "must-never-reach-claude",
    },
    stack: "stack-line\n".repeat(200),
    details: { first: { second: { third: { fourth: "too deep" } } } },
    status: 422,
  };
  const event = {
    evidenceId: "E1",
    type: "api-request",
    status: "error",
    statusCode: 422,
    method: "POST",
    url: "/api/customers",
    requestHeaders: {
      "Content-Type": "application/json",
      Authorization: "Bearer private",
      "X-Unrelated": "discard me",
    },
    requestData: {
      email: "person@example.com",
      password: "private-password",
    },
    responseData,
  };
  const original = structuredClone(event);
  const result = buildInvestigationContext({ ...evidence, events: [event] });
  const [compacted] = getContextEvents(result.context);

  assert.deepEqual(event, original);
  assert.equal(compacted.responseData.message, "Customer already exists");
  assert.equal(compacted.responseData.errorCode, "DUPLICATE_CUSTOMER");
  assert.equal(
    compacted.responseData.validationErrors.phone,
    "Phone number is already registered",
  );
  assert.equal(
    compacted.responseData.validationErrors.password,
    "[REDACTED]",
  );
  assert.match(compacted.responseData.stack, /\.\.\.\[truncated\]$/);
  assert.equal(
    compacted.responseData.details.first.second.third._truncated,
    true,
  );
  assert.equal(compacted.requestData.password, "[REDACTED]");
  assert.equal(compacted.requestHeaders.Authorization, "[REDACTED]");
  assert.equal(compacted.requestHeaders["X-Unrelated"], undefined);
  assert.equal(compacted.responseData.records._type, "array");
  assert.equal(compacted.responseData.records._length, 100);
  assert.equal(compacted.responseData.records._items.length, 3);
  assert.equal(compacted.responseDataCompaction.truncated, true);
  assert.equal(
    compacted.responseDataCompaction.originalCharacterCount,
    JSON.stringify(responseData).length,
  );
  assert.ok(result.context.split("\n").every((line) => line.length <= 4000));
});

test("summarizes successful responses more aggressively for AI", () => {
  const event = {
    evidenceId: "E1",
    type: "api-request",
    status: "success",
    statusCode: 200,
    responseData: {
      success: true,
      total: 5000,
      customers: Array.from({ length: 5000 }, (_, index) => ({
        id: index,
        name: `Customer ${index}`,
      })),
    },
  };
  const result = buildInvestigationContext({ ...evidence, events: [event] });
  const [compacted] = getContextEvents(result.context);

  assert.equal(compacted.responseData.success, true);
  assert.equal(compacted.responseData.total, 5000);
  assert.equal(compacted.responseData.customers._type, "array");
  assert.equal(compacted.responseData.customers._length, 5000);
  assert.equal(compacted.responseData.customers._items.length, 1);
  assert.equal(compacted.responseDataCompaction.truncated, true);
});

test("keeps small primitive and null response payloads understandable", () => {
  const result = buildInvestigationContext({
    ...evidence,
    events: [
      { evidenceId: "E1", type: "api-request", status: "success", responseData: "ok" },
      { evidenceId: "E2", type: "api-request", status: "error", responseData: null },
    ],
  });
  const compacted = getContextEvents(result.context);

  assert.equal(compacted[0].responseData, "ok");
  assert.equal(compacted[0].responseDataCompaction, undefined);
  assert.equal(compacted[1].responseData, null);
});

test("adds trustworthy session-relative times to AI-only evidence", () => {
  const result = buildInvestigationContext({
    ...evidence,
    events: [
      {
        evidenceId: "E1",
        type: "user-click",
        timestamp: "2026-09-20T10:00:30.000Z",
        incidentOffsetMs: 8000,
      },
      {
        evidenceId: "E2",
        type: "api-request",
        timestamp: "2026-09-20T10:00:09.000Z",
      },
      {
        evidenceId: "E3",
        type: "console",
        timestamp: "2026-09-20T09:59:59.000Z",
        evidenceTime: "forged",
        evidenceOffsetMs: 999999,
      },
      {
        evidenceId: "E4",
        type: "console",
        timestamp: "2026-09-20T11:01:02.000Z",
      },
    ],
  });

  const compacted = getContextEvents(result.context);

  assert.equal(compacted[0].evidenceOffsetMs, 8000);
  assert.equal(compacted[0].evidenceTime, "00:08");
  assert.equal(compacted[1].evidenceOffsetMs, 9000);
  assert.equal(compacted[1].evidenceTime, "00:09");
  assert.doesNotMatch(result.context, /forged|999999/);
  assert.equal(compacted[3].evidenceTime, "01:01:02");
});

test("generates exactly ten unique questions with failure-first instructions", async () => {
  const questions = [
    "Why did POST /api/customers return HTTP 500?",
    "Did the request time out?",
    "Was the payload rejected?",
    "Was the response malformed?",
    "Was authorization invalid?",
    "Was the request unusually slow?",
    "Did this request repeat?",
    "What happened during navigation?",
    "Which page was active?",
    "What successful action preceded it?",
  ];
  const questionSlots = Object.fromEntries(
    questions.map((question, index) => [`question${index + 1}`, question]),
  );
  let request;
  let calls = 0;
  const client = {
    messages: {
      create: async (body) => {
        calls += 1;
        request = body;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ questions: questionSlots }),
          }],
        };
      },
    },
  };

  assert.deepEqual(await generateInvestigationQuestions(evidence, client), questions);
  assert.equal(request.model, process.env.ANTHROPIC_MODEL || "claude-opus-5");
  assert.equal(request.max_tokens, 2500);
  assert.equal(request.system[1].cache_control.ttl, "5m");
  assert.equal(request.output_config.format.type, "json_schema");
  assert.deepEqual(
    request.output_config.format.schema.properties.questions.required,
    Object.keys(questionSlots),
  );
  assert.match(request.messages[0].content, /HTTP 5xx/);
  assert.match(request.messages[0].content, /highest-confidence failure/);
  assert.match(request.messages[0].content, /failed API request before indirect symptoms/);
  assert.match(request.messages[0].content, /exactly one valid JSON object/);
  assert.match(request.messages[0].content, /Do not return Markdown/);
  assert.match(request.messages[0].content, /question10/);
  assert.match(request.messages[0].content, /no more than 30 words/);
  assert.match(request.messages[0].content, /\[E4\]\[E5\]/);
  assert.equal(calls, 1);
});

test("returns demo questions after one empty Claude response", async () => {
  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        calls += 1;
        return {
          content: [{ type: "text", text: '{"questions":{}}' }],
        };
      },
    },
  };

  assert.deepEqual(
    await generateInvestigationQuestions(evidence, client),
    aiInvestigatorDemoQuestions,
  );
  assert.equal(calls, 1);
});

test("returns demo questions for structurally unusable Claude output", async () => {
  const client = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: '{"message":"No questions"}' }],
      }),
    },
  };

  assert.deepEqual(
    await generateInvestigationQuestions(evidence, client),
    aiInvestigatorDemoQuestions,
  );
});

test("returns demo questions for truncated Markdown-prefixed JSON", async () => {
  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        calls += 1;
        return {
          content: [{
            type: "text",
            text: '### {"questions":{"question1":"First?","question2":"Second?","question3":"What caused the non-',
          }],
          stop_reason: "max_tokens",
        };
      },
    },
  };

  assert.deepEqual(
    await generateInvestigationQuestions(evidence, client),
    aiInvestigatorDemoQuestions,
  );
  assert.equal(calls, 1);
});

test("returns demo questions for an incomplete Claude stop reason", async () => {
  const questions = Array.from(
    { length: 10 },
    (_, index) => `Question ${index + 1}?`,
  );
  const client = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify({ questions }) }],
        stop_reason: "max_tokens",
      }),
    },
  };

  assert.deepEqual(
    await generateInvestigationQuestions(evidence, client),
    aiInvestigatorDemoQuestions,
  );
});

test("returns a partial response without retrying or using the fallback", async () => {
  const questions = ["First question?", "Second question?"];
  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        calls += 1;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ questions }),
          }],
        };
      },
    },
  };

  assert.deepEqual(
    await generateInvestigationQuestions(evidence, client),
    questions,
  );
  assert.equal(calls, 1);
});

test("accepts best-effort question response formats without throwing", async () => {
  const responses = [
    {
      text: '```json\n{"questions":["Why did the request fail?"]}\n```',
      expected: aiInvestigatorDemoQuestions,
    },
    {
      text: 'Result: {"questions":["Was the payload rejected?"]} done',
      expected: aiInvestigatorDemoQuestions,
    },
    {
      text: '["Why was the request slow?"]',
      expected: ["Why was the request slow?"],
    },
    {
      text: "1. Why did the request fail?\n- Was the payload rejected?",
      expected: ["Why did the request fail?", "Was the payload rejected?"],
    },
    {
      text: "A raw investigation question",
      expected: ["A raw investigation question"],
    },
    { text: "", expected: aiInvestigatorDemoQuestions },
  ];

  for (const response of responses) {
    const client = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: response.text }],
        }),
      },
    };

    assert.deepEqual(
      await generateInvestigationQuestions(evidence, client),
      response.expected,
    );
  }
});

test("returns grounded citations without rejecting unknown evidence references", async () => {
  const answer = {
    answer: "The request failed at 00:00 [E1].",
    likelyCause: "The backend returned HTTP 500 [E1].",
    evidence: [{ evidenceId: "E1", summary: "The request returned 500." }],
    nextSteps: ["Inspect the backend trace."],
  };
  const client = {
    messages: {
      create: async (request) => {
        assert.equal(request.max_tokens, 1500);
        assert.match(request.system[0].text, /chronological order/);
        assert.match(request.system[0].text, /\[E7\]/);
        assert.match(request.messages[0].content, /chronological sequence/);
        return {
          content: [{ type: "text", text: JSON.stringify(answer) }],
        };
      },
    },
  };

  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why did it fail?", client),
    { ...answer, citations: [citationE1] },
  );

  answer.answer = "The request failed at 00:00 [E999].";
  answer.likelyCause = "The backend returned HTTP 500.";
  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why did it fail?", client),
    { ...answer, citations: [] },
  );
});

test("allows missing citations and optional answer fields", async () => {
  let response = {
    answer: "  The request returned 500 [E1].  ",
    likelyCause: "  The server rejected the operation [E1].  ",
    evidence: [{ evidenceId: " E1 ", summary: " Returned HTTP 500. " }],
    nextSteps: [" Inspect the server trace for this request. "],
  };
  const client = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(response) }],
      }),
    },
  };

  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why?", client),
    {
      answer: "The request returned 500 [E1].",
      likelyCause: "The server rejected the operation [E1].",
      evidence: [{ evidenceId: "E1", summary: "Returned HTTP 500." }],
      nextSteps: ["Inspect the server trace for this request."],
      citations: [citationE1],
    },
  );

  response = { answer: "The request failed [E1]." };
  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why?", client),
    {
      answer: "The request failed [E1].",
      likelyCause: "",
      evidence: [],
      nextSteps: [],
      citations: [citationE1],
    },
  );

  for (const invalidResponse of [
    { answer: "The request failed without a citation." },
    { answer: "The request failed [E999]." },
  ]) {
    response = invalidResponse;
    assert.deepEqual(
      await answerInvestigationQuestion(evidence, "Why?", client),
      {
        answer: invalidResponse.answer,
        likelyCause: "",
        evidence: [],
        nextSteps: [],
        citations: [],
      },
    );
  }
});

test("uses plain or empty Claude text as a non-blocking answer", async () => {
  let text = "The backend request failed without structured JSON.";
  const client = {
    messages: {
      create: async () => ({ content: [{ type: "text", text }] }),
    },
  };

  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why?", client),
    {
      answer: text,
      likelyCause: "",
      evidence: [],
      nextSteps: [],
      citations: [],
    },
  );

  text = "";
  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why?", client),
    {
      answer: "",
      likelyCause: "",
      evidence: [],
      nextSteps: [],
      citations: [],
    },
  );
});

test("accepts Markdown-wrapped and surrounding-text answer JSON", async () => {
  const expected = {
    answer: "The request failed [E1].",
    likelyCause: "",
    evidence: [],
    nextSteps: [],
  };
  let text = `\`\`\`json\n${JSON.stringify(expected)}\n\`\`\``;
  const client = {
    messages: {
      create: async () => ({ content: [{ type: "text", text }] }),
    },
  };

  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why?", client),
    { ...expected, citations: [citationE1] },
  );

  text = `Result: ${JSON.stringify(expected)} done`;
  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why?", client),
    { ...expected, citations: [citationE1] },
  );
});

test("maps unique inline citations to ordered event navigation metadata", async () => {
  const events = Array.from({ length: 8 }, (_, index) => ({
    evidenceId: `E${index + 1}`,
    type: index === 7 ? "api-request" : "console",
    timestamp: `2026-09-20T10:00:0${index + 1}.000Z`,
  }));
  const output = {
    answer: "The request failed [E8], after an earlier warning [E2] [E8].",
    likelyCause: "The failure is visible in the request [E8].",
    evidence: [],
    nextSteps: [],
  };
  const client = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(output) }],
      }),
    },
  };

  const result = await answerInvestigationQuestion(
    { ...evidence, events },
    "Why?",
    client,
  );

  assert.deepEqual(result.citations, [
    {
      evidenceId: "E8",
      eventIndex: 7,
      evidenceOffsetMs: 8000,
      evidenceTime: "00:08",
      type: "api-request",
      timestamp: "2026-09-20T10:00:08.000Z",
    },
    {
      evidenceId: "E2",
      eventIndex: 1,
      evidenceOffsetMs: 2000,
      evidenceTime: "00:02",
      type: "console",
      timestamp: "2026-09-20T10:00:02.000Z",
    },
  ]);
});

test("accepts an honest insufficient-evidence answer with a citation", async () => {
  const output = {
    answer: "The supplied evidence confirms only that the request failed [E1].",
    likelyCause: "The cause cannot be established because no server trace was captured.",
    evidence: [],
    nextSteps: ["Capture the server trace for the failed request."],
  };
  const client = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(output) }],
      }),
    },
  };

  assert.deepEqual(
    await answerInvestigationQuestion(evidence, "Why?", client),
    { ...output, citations: [citationE1] },
  );
});

test("uses demo questions for Claude failures while ask still rejects", async () => {
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

  const warning = mock.method(console, "warn", () => {});

  assert.deepEqual(
    await generateInvestigationQuestions(evidence, rateLimitedClient),
    aiInvestigatorDemoQuestions,
  );
  assert.deepEqual(
    await generateInvestigationQuestions(evidence, timeoutClient),
    aiInvestigatorDemoQuestions,
  );
  await assert.rejects(
    answerInvestigationQuestion(evidence, "Why?", rateLimitedClient),
    (error) => error.status === 429 && error.details === rateLimitMessage,
  );
  await assert.rejects(
    answerInvestigationQuestion(evidence, "Why?", timeoutClient),
    (error) => error.status === 504,
  );

  warning.mock.restore();
});

test("uses demo questions without Anthropic configuration while ask rejects", async () => {
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const warning = mock.method(console, "warn", () => {});

  try {
    assert.deepEqual(
      await generateInvestigationQuestions(evidence),
      aiInvestigatorDemoQuestions,
    );
    await assert.rejects(
      answerInvestigationQuestion(evidence, "Why?"),
      (error) =>
        error.status === 503 &&
        error.message === "ANTHROPIC_API_KEY is not configured",
    );
  } finally {
    if (previousApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = previousApiKey;
    }
    warning.mock.restore();
  }
});

test("rejects unsupported investigation sources before accessing storage", () => {
  assert.throws(
    () => loadInvestigationEvidence({ sourceType: "unknown", sourceId: "x" }),
    /Unsupported AI investigation source/,
  );
});
