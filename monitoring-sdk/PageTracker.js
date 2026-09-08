import { getSessionId } from "./Identity";

import { addEvent } from "./EventQueue";

let currentPage = null;
let isStarted = false;

function startPage() {
  currentPage = {
    sessionId: getSessionId(),
    url: window.location.href,
    enteredAt: new Date().toISOString(),
    startTime: performance.now(),
  };
}

function finishPage(reason) {
  if (!currentPage) {
    return;
  }

  const now = performance.now();

  const duration = Math.round(now - currentPage.startTime);
  const timestamp = new Date().toISOString();

  addEvent({
    type: "page-transition",

    timestamp,

    sessionId: currentPage.sessionId,

    url: currentPage.url,

    enteredAt: currentPage.enteredAt,

    leftAt: timestamp,

    duration,

    reason,
  });

  currentPage = null;
}

function handleNavigation() {
  const newUrl = window.location.href;

  if (currentPage && currentPage.url === newUrl) {
    return;
  }

  finishPage("navigation");

  startPage();
}

function handleVisibilityChange() {
  if (document.hidden) {
    finishPage("tab-hidden");
  } else if (!currentPage) {
    startPage();
  }
}

function handlePageShow(event) {
  if (!event.persisted) {
    return;
  }

  if (!currentPage) {
    startPage();
  }
}

function handlePageHide(event) {
  if (!currentPage) {
    return;
  }

  if (event.persisted) {
    finishPage("bfcache");
  } else {
    finishPage("page-unloaded");
  }
}

export function startPageTracker() {
  if (isStarted) {
    return;
  }

  isStarted = true;

  startPage();

  window.addEventListener("popstate", handleNavigation);

  window.addEventListener("hashchange", handleNavigation);

  const originalPushState = history.pushState;

  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);

    handleNavigation();

    return result;
  };

  const originalReplaceState = history.replaceState;

  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);

    handleNavigation();

    return result;
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  window.addEventListener("pageshow", handlePageShow);

  window.addEventListener("pagehide", handlePageHide);
}
