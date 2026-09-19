import { getPageViewId, getSessionId, getTabId } from "./Identity.js";
import { sendLiveEvent } from "./LiveMonitor.js";

const queue = [];
let activeIncident;

export function setActiveIncident(incident) {
  activeIncident = incident;
}

export function clearActiveIncident() {
  activeIncident = undefined;
}

export function addEvent(event) {
  const enrichedEvent = {
    sessionId: getSessionId(),
    ...event,
    tabId: getTabId(),
    pageViewId: getPageViewId(),
    ...(activeIncident && {
      incidentId: activeIncident.incidentId,
      incidentOffsetMs: Math.max(0, Date.now() - activeIncident.startedAtMs),
    }),
  };

  queue.push(enrichedEvent);
  sendLiveEvent(enrichedEvent);
}

export function getQueue() {
  const tabId = getTabId();

  return queue.splice(0, queue.length).map((event) => ({ ...event, tabId }));
}

export function restoreQueue(events) {
  queue.unshift(...events);
}
