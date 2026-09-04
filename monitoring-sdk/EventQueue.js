// monitoring/EventQueue.js

import { getPageViewId, getSessionId, getTabId } from "./Identity";

const queue = []

export function addEvent(event) {
    queue.push({
        sessionId: getSessionId(),
        ...event,
        tabId: getTabId(),
        pageViewId: getPageViewId(),
    })
}

export function getQueue() {
    return queue.splice(0, queue.length)
}
