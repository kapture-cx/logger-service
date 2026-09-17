import { getPageViewId, getSessionId, getTabId } from "./Identity";
import { sendLiveEvent } from "./LiveMonitor";

const queue = [];

export function addEvent(event) {
  const enrichedEvent = {
    sessionId: getSessionId(),
    ...event,
    tabId: getTabId(),
    pageViewId: getPageViewId(),
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
