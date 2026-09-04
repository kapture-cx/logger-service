const SESSION_KEY = "monitoring_session_id";
const TAB_KEY = "monitoring_tab_id";

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
  let tabId = sessionStorage.getItem(TAB_KEY);

  if (!tabId) {
    tabId = crypto.randomUUID();

    sessionStorage.setItem(TAB_KEY, tabId);
  }

  return tabId;
}

export function createPageViewId() {
  return crypto.randomUUID();
}
