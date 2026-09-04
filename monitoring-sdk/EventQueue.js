// monitoring/EventQueue.js

import { getSessionId } from "./Identity";

const queue = []

export function addEvent(event) {
    queue.push({
        sessionId: getSessionId(),
        ...event,
    })
}

export function getQueue() {
    return queue.splice(0, queue.length)
}
