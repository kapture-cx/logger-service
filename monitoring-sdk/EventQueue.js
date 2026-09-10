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
    const tabId = getTabId()

    return queue.splice(0, queue.length).map(event => ({ ...event, tabId }))
}

export function restoreQueue(events) {
    queue.unshift(...events)
}
