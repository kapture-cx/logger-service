import { createHash } from "node:crypto";

const MINIMUM_OCCURRENCES = 3;
const MAX_EVIDENCE = 5;
const SLOW_API_THRESHOLD_MS = 500;

function normalizeMessage(value) {
  return String(value ?? "Unknown error").replace(/\s+/g, " ").trim().slice(0, 300);
}

function getEndpoint(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    return new URL(value, "http://monitoring.local").pathname;
  } catch {
    return value.split(/[?#]/, 1)[0] || null;
  }
}

function getIdentity(event) {
  const cmId = event.clientDetails?.cmId;

  if (cmId === null || cmId === undefined || String(cmId).trim() === "") {
    return null;
  }

  const customerName = event.clientDetails?.customerName ??
    event.clientDetails?.clientName ??
    event.clientDetails?.clientKey;

  return {
    app: event.app,
    cmId: String(cmId).trim(),
    customerName: customerName === null || customerName === undefined
      ? null
      : String(customerName).trim() || null,
  };
}

function fingerprint(type, app, cmId, key) {
  return createHash("sha256")
    .update(`${type}\u0000${app}\u0000${cmId}\u0000${key}`)
    .digest("hex");
}

function evidence(event, endpoint) {
  return {
    eventId: event.id,
    type: event.type,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    pageViewId: event.pageViewId,
    method: event.method ? String(event.method).toUpperCase() : undefined,
    url: endpoint,
    statusCode: event.statusCode,
    duration: event.duration,
    message: event.message ?? event.errorMessage,
  };
}

function addGroup(groups, type, event, key, details = {}) {
  const identity = getIdentity(event);
  if (!identity) return;

  const groupKey = `${type}\u0000${identity.app}\u0000${identity.cmId}\u0000${key}`;
  const group = groups.get(groupKey) ?? {
    type,
    key,
    ...identity,
    events: [],
    ...details,
  };

  group.events.push(event);
  groups.set(groupKey, group);
}

function toDetection(group, { severity, title, summary, endpoint }) {
  const timestamps = group.events
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite)
    .sort((first, second) => first - second);
  const now = Date.now();
  const affectedSessions = new Set(
    group.events.map((event) => event.sessionId).filter(Boolean).map(String),
  ).size;

  return {
    app: group.app,
    cmId: group.cmId,
    customerName: group.customerName,
    fingerprint: fingerprint(group.type, group.app, group.cmId, group.key),
    type: group.type,
    severity,
    title,
    summary,
    occurrenceCount: group.events.length,
    affectedSessions,
    evidence: group.events.slice(-MAX_EVIDENCE).map((event) => evidence(event, endpoint)),
    firstSeenAt: new Date(timestamps[0] ?? now).toISOString(),
    lastSeenAt: new Date(timestamps.at(-1) ?? now).toISOString(),
  };
}

export function buildDetections(events) {
  const apiGroups = new Map();
  const runtimeGroups = new Map();
  const consoleGroups = new Map();

  for (const event of events) {
    if (!event || typeof event !== "object" || !getIdentity(event)) continue;

    if (event.type === "api-request") {
      const endpoint = getEndpoint(event.url);
      if (!endpoint) continue;
      const method = String(event.method ?? "REQUEST").toUpperCase();
      addGroup(apiGroups, "api", event, `${method} ${endpoint}`, { method, endpoint });
    } else if (["javascript-error", "promise-error"].includes(event.type)) {
      const message = normalizeMessage(event.message ?? event.errorMessage);
      addGroup(runtimeGroups, event.type, event, message, { message });
    } else if (event.type === "console" && String(event.level).toLowerCase() === "error") {
      const message = normalizeMessage(event.message);
      addGroup(consoleGroups, "console-error", event, message, { message });
    }
  }

  const detections = [];

  for (const group of apiGroups.values()) {
    const failures = group.events.filter((event) => {
      const status = String(event.status ?? "").toLowerCase();
      const statusCode = Number(event.statusCode);
      return ["error", "failed", "failure"].includes(status) ||
        (Number.isFinite(statusCode) && statusCode >= 400);
    });

    if (failures.length >= MINIMUM_OCCURRENCES && failures.length / group.events.length >= 0.5) {
      detections.push(toDetection(
        { ...group, type: "api-failure", events: failures },
        {
          severity: "high",
          endpoint: group.endpoint,
          title: `High failure rate for ${group.method} ${group.endpoint}`,
          summary: `${failures.length} of ${group.events.length} requests failed during the latest detection window.`,
        },
      ));
    }

    const timed = group.events.filter((event) => {
      const duration = Number(event.duration);
      return Number.isFinite(duration) && duration >= 0;
    });
    const averageDuration = timed.length
      ? timed.reduce((total, event) => total + Number(event.duration), 0) / timed.length
      : 0;

    if (timed.length >= MINIMUM_OCCURRENCES && averageDuration >= SLOW_API_THRESHOLD_MS) {
      detections.push(toDetection(
        { ...group, type: "slow-api", events: timed },
        {
          severity: "medium",
          endpoint: group.endpoint,
          title: `Slow API endpoint ${group.method} ${group.endpoint}`,
          summary: `${timed.length} requests averaged ${Math.round(averageDuration)} ms during the latest detection window.`,
        },
      ));
    }
  }

  for (const group of runtimeGroups.values()) {
    if (group.events.length < MINIMUM_OCCURRENCES) continue;
    detections.push(toDetection(group, {
      severity: "critical",
      title: `Repeated ${group.type === "promise-error" ? "promise rejection" : "JavaScript error"}`,
      summary: `${group.events.length} occurrences of “${group.message}” were detected.`,
    }));
  }

  for (const group of consoleGroups.values()) {
    if (group.events.length < MINIMUM_OCCURRENCES) continue;
    detections.push(toDetection(group, {
      severity: "high",
      title: "Repeated console error",
      summary: `${group.events.length} occurrences of “${group.message}” were detected.`,
    }));
  }

  return detections;
}
