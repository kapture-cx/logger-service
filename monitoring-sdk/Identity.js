const SESSION_KEY = "monitoring_session_id";
const TAB_KEY = "monitoring_tab_id";

let currentTabId;
let currentPageViewId;

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

export function getTabId() {
  if (currentTabId) {
    return currentTabId;
  }

  try {
    currentTabId = sessionStorage.getItem(TAB_KEY);
  } catch (error) {
    // Fall back to an in-memory ID when session storage is unavailable.
  }

  if (!currentTabId) {
    try {
      currentTabId = crypto.randomUUID();
    } catch (error) {
      return null;
    }

    try {
      sessionStorage.setItem(TAB_KEY, currentTabId);
    } catch (error) {
      // The in-memory ID remains stable for the loaded document.
    }
  }

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
