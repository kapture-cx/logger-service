import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addEvent,
  clearActiveIncident,
  getQueue,
  setActiveIncident,
} from "../monitoring-sdk/EventQueue.js";

test("adds incident correlation only while recording is active", () => {
  getQueue();
  addEvent({ type: "before" });
  setActiveIncident({ incidentId: "incident-1", startedAtMs: Date.now() - 20 });
  addEvent({ type: "during" });
  clearActiveIncident();
  addEvent({ type: "after" });

  const [before, during, after] = getQueue();

  assert.equal(before.incidentId, undefined);
  assert.equal(during.incidentId, "incident-1");
  assert.ok(during.incidentOffsetMs >= 0);
  assert.equal(after.incidentId, undefined);
});
