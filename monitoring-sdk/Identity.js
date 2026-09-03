const SESSION_KEY = "monitoring_session_id";
const TAB_KEY = "monitoring_tab_id";

export function setSessionId(sessionId) {
  localStorage.setItem(SESSION_KEY, sessionId);
}

export function getSessionId() {
  return localStorage.getItem(SESSION_KEY);
}

export function clearSessionId() {
  localStorage.removeItem(SESSION_KEY);
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