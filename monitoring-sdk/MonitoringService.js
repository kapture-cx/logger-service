// monitoring/MonitoringService.js

import { startConsoleTracker } from "./ConsoleTracker";
import {
  startErrorBoundaryTracker,
  startErrorTracker,
  startPromiseTracker,
} from "./ErrorTracker";
import { getQueue, restoreQueue } from "./EventQueue";
import { startFetchTracker } from "./FetchTracker";
import { getTabId } from "./Identity";
import { OriginalConsole } from "./OriginalConsole";
import { startPageTracker } from "./PageTracker";

let clientDetailsProvider;
let reportEvents;

export function normalizeEndpoint(value) {
  const endpoint =
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  if (!endpoint) {
    return undefined;
  }

  try {
    const url = new URL(endpoint, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch (error) {
    return undefined;
  }
}

function getCurrentCmId() {
  if (typeof clientDetailsProvider !== "function") {
    return undefined;
  }

  try {
    const cmId = clientDetailsProvider()?.cmId;
    return cmId === undefined || cmId === null
      ? undefined
      : String(cmId).trim();
  } catch (error) {
    return undefined;
  }
}

function getFreshClientDetails() {
  if (typeof clientDetailsProvider !== "function") {
    return {};
  }

  try {
    const clientDetails = clientDetailsProvider();

    if (
      !clientDetails ||
      typeof clientDetails !== "object" ||
      Array.isArray(clientDetails)
    ) {
      OriginalConsole.warn(
        "MonitoringService: client details provider must return an object",
      );
      return {};
    }

    const normalizedClientDetails = JSON.parse(JSON.stringify(clientDetails));

    if (
      !normalizedClientDetails ||
      typeof normalizedClientDetails !== "object" ||
      Array.isArray(normalizedClientDetails)
    ) {
      OriginalConsole.warn(
        "MonitoringService: client details provider must return a JSON object",
      );
      return {};
    }

    return normalizedClientDetails;
  } catch (error) {
    OriginalConsole.error(
      "MonitoringService: failed to get client details",
      error,
    );
    return {};
  }
}

export const MonitoringService = {
  flush() {
    return reportEvents ? reportEvents() : Promise.resolve(false);
  },

  // if SDK loads first , this sets clientDetailsProvider
  setClientDetailsProvider(provider) {
    if (typeof provider !== "function") {
      OriginalConsole.warn(
        "MonitoringService: setClientDetailsProvider expects a function",
      );
      return false;
    }

    clientDetailsProvider = provider;
    return true;
  },

  start(config = {}) {
    try {
      const shouldMonitor = true || window.location.hostname !== "localhost";

      if (!shouldMonitor) {
        return {
          status: "success",
          message: "Monitoring is disabled on localhost",
        };
      }

      if (window.__kaptureMonitoringStarted) {
        return {
          status: "success",
          message: "Monitoring is already attached",
        };
      }

      const endpoint = normalizeEndpoint(config.endpoint);

      if (!endpoint) {
        return {
          status: "error",
          message: "Monitoring endpoint must be a valid HTTP or HTTPS URL",
        };
      }

      // if react loads first , this sets clientDetailsProvider
      if (typeof config.getClientDetails === "function") {
        clientDetailsProvider = config.getClientDetails;
      }

      getTabId();

      startConsoleTracker(getCurrentCmId);
      startErrorTracker();
      startPromiseTracker();
      startFetchTracker({
        getCurrentCmId,
        ignoredUrls: [endpoint],
      });
      startErrorBoundaryTracker();
      startPageTracker();

      window.__kaptureMonitoringStarted = true;

      reportEvents = async (event) => {
        const events = getQueue();

        if (events.length === 0) {
          return true;
        }

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: event?.type === "pagehide",
            body: JSON.stringify({
              app: config.app,
              events,
              clientDetails: getFreshClientDetails(),
            }),
          });

          if (!response.ok) {
            throw new Error(`Monitoring endpoint returned ${response.status}`);
          }

          return true;
        } catch (error) {
          restoreQueue(events);
          OriginalConsole.error(
            "MonitoringService: failed to report events",
            error,
          );
          return false;
        }
      };

      window.addEventListener("pagehide", reportEvents);
      setInterval(reportEvents, 20000);

      return {
        status: "success",
        message: "Monitoring attached successfully",
      };
    } catch (error) {
      try {
        OriginalConsole.error("MonitoringService: failed to attach", error);
      } catch (_error) {
        // Monitoring errors must never prevent the application from loading.
      }

      return {
        status: "error",
        message: "Monitoring failed to attach",
      };
    }
  },
};
