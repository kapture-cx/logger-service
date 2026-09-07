const SESSION_KEY = "monitoring_session_id";
const TAB_KEY = "monitoring_tab_id";
const TAB_CHANNEL_NAME = "kapture_monitoring_tab_identity";

let currentTabId;
let currentPageViewId;
let tabIdentityChannel;

export function setSessionId(sessionId) {
  const normalizedSessionId =
    typeof sessionId === "string" ? sessionId.trim() : "";

  if (!normalizedSessionId) {
    return false;
  }

  try {
    localStorage.setItem(SESSION_KEY, normalizedSessionId);
    return true;
  } catch (error) {
    return false;
  }
}

export function getSessionId() {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch (error) {
    return null;
  }
}

export function clearSessionId() {
  try {
    localStorage.removeItem(SESSION_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

function storeTabId(tabId) {
  currentTabId = tabId;

  try {
    sessionStorage.setItem(TAB_KEY, tabId);
  } catch (error) {
    // The in-memory ID remains stable when session storage is unavailable.
  }
}

function postTabIdentityProbe() {
  tabIdentityChannel.postMessage({
    type: "probe",
    tabId: currentTabId,
    claimant: getPageViewId(),
  });
}

function handleTabIdentityMessage(event) {
  try {
    const message = event?.data;
    const claimant = getPageViewId();

    if (
      !message ||
      message.tabId !== currentTabId ||
      typeof message.claimant !== "string" ||
      !claimant
    ) {
      return;
    }

    if (message.type === "probe" && message.claimant !== claimant) {
      tabIdentityChannel.postMessage({
        type: "occupied",
        tabId: currentTabId,
        claimant: message.claimant,
      });
    } else if (
      message.type === "occupied" &&
      message.claimant === claimant
    ) {
      storeTabId(crypto.randomUUID());
      postTabIdentityProbe();
    }
  } catch (error) {
    // Tab coordination must never interrupt the monitored application.
  }
}

function startTabIdentityCoordination() {
  if (
    tabIdentityChannel ||
    !currentTabId ||
    typeof BroadcastChannel !== "function"
  ) {
    return;
  }

  try {
    tabIdentityChannel = new BroadcastChannel(TAB_CHANNEL_NAME);
    tabIdentityChannel.addEventListener("message", handleTabIdentityMessage);
    postTabIdentityProbe();
  } catch (error) {
    try {
      tabIdentityChannel?.close();
    } catch (_error) {
      // Ignore cleanup failures from a partially initialized channel.
    }

    tabIdentityChannel = undefined;
  }
}

export function getTabId() {
  if (!currentTabId) {
    try {
      currentTabId = sessionStorage.getItem(TAB_KEY);
    } catch (error) {
      // Fall back to an in-memory ID when session storage is unavailable.
    }

    if (!currentTabId) {
      try {
        storeTabId(crypto.randomUUID());
      } catch (error) {
        return null;
      }
    }
  }

  startTabIdentityCoordination();

  return currentTabId;
}

export function createPageViewId() {
  return crypto.randomUUID();
}

export function getPageViewId() {
  if (!currentPageViewId) {
    try {
      currentPageViewId = createPageViewId();
    } catch (error) {
      return null;
    }
  }

  return currentPageViewId;
}
