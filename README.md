# Logger service backend

This service stores frontend monitoring events and hosts the browser monitoring
SDK used to collect them.

## Run locally

```bash
npm run dev
```

The API listens on `http://localhost:3001` by default. The example environment
uses port `5001`. Configure the port, database, and allowed frontend origins with
the environment variables documented in `.env.example`.

`FRONTEND_ORIGINS` is a comma-separated allowlist. For example, local development
and a deployed CRM can be enabled together with
`FRONTEND_ORIGINS=http://localhost:3000,https://crm.example.com`.
`FRONTEND_ORIGIN` remains supported as a fallback for older deployments.

## Load the monitoring SDK

The standalone SDK is publicly available at:

```text
http://localhost:5001/monitoring/v1/monitoring.min.js
```

For anonymous monitoring, add one script element. When `data-endpoint` is
omitted, the SDK derives `/api/logs` from the script URL:

```html
<script
  src="http://localhost:5001/monitoring/v1/monitoring.min.js"
  data-app="kapturecrm-ui"
></script>
```

The `/v1/` segment pins the application to the version 1 public SDK contract.
Future breaking contracts will use a separate major-version URL such as `/v2/`.
The old unversioned `/monitoring/monitoring.min.js` URL is not served, and each
page must load only one monitoring SDK version to avoid duplicate event capture.

Applications can register a synchronous provider after the SDK loads. The
provider is evaluated once immediately before each log request, so the complete
batch receives the latest Redux state available when it is sent:

```js
window.KaptureMonitoring.setClientDetailsProvider(() => {
  const state = store.getState()

  return {
    userId: state.global?.currentEmployee?.id,
    cmId: state.general?.chatCredentials?.cmId,
    isLoggedIn: Boolean(state.auth?.user?.isLogin),
  }
})
```

Every flush sends at most one request using the existing
`{ app, events, clientDetails }` structure. If Redux state changes during the
flush interval, the latest state is applied to the complete batch.

For backward compatibility, `window.KaptureMonitoringConfig` can still be set
before loading the script. The configuration supports:

- `endpoint`: the complete log-ingestion URL, such as
  `http://localhost:5001/api/logs`.
- `app`: the application name stored with each event.
- `getClientDetails`: an optional callback that becomes the initial client
  details provider.

`data-endpoint` and `data-app` take precedence over global configuration. When
neither endpoint is supplied, the SDK derives `/api/logs` from its own source
URL. The script loads as a classic IIFE and starts automatically.

The SDK file is intentionally public. Browser log submission is restricted by
the API origin allowlist; CORS is not authentication and does not prevent direct
non-browser requests.

If the consuming application uses Content Security Policy, its `script-src` must
allow this backend to load the SDK and its `connect-src` must allow the SDK to
post events.

## Associate events with a monitoring session

The SDK starts collecting events as soon as the CDN script loads. Before login,
events have `sessionId: null` when no monitoring ID was deliberately stored from
an earlier session. After the application's existing login request succeeds,
give the SDK a monitoring correlation ID:

```js
const monitoringSessionId = loginResponse.data.monitoringSessionId

window.MonitoringService.setSessionId(monitoringSessionId)
```

After the application's existing logout request succeeds, clear it:

```js
window.MonitoringService.clearSessionId()
```

`setSessionId` accepts a non-empty string, stores its trimmed value, and returns
`true`. Invalid values return `false` and leave the current session unchanged.
`clearSessionId` returns `true` after removing the value. Pass only a monitoring
correlation ID—never an access token, refresh token, password, or other
credential.

Only `setSessionId` and `clearSessionId` are exposed on
`window.MonitoringService`. Session reads and tab/page-view identity remain SDK
internals. The existing `window.KaptureMonitoring` API continues to provide the
client-details integration described above.

## Update the monitoring SDK

The editable source is in `monitoring-sdk/`. Never edit the minified file
directly. After changing the source, regenerate and verify the committed bundle:

```bash
npm run build:monitoring
npm run check:monitoring
```

The test command also verifies that the committed bundle matches its source.

## Submit frontend logs

Send a log envelope to `POST /api/logs`:

```js
const response = await fetch("http://localhost:3001/api/logs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    app: "kapturecrm-ui",
    events: [
      { level: "info", message: "Page loaded" },
      { level: "error", message: "Request failed", status: 500 },
    ],
    clientDetails: {
      cmId: "CM-123",
      browser: "Chrome",
      os: "macOS",
      version: "140.0",
    },
  }),
});

if (!response.ok) {
  throw new Error(`Logging failed with status ${response.status}`);
}
```

`clientDetails` is optional for backward compatibility. When supplied, it must be
a JSON object; values such as `null`, arrays, strings, numbers, and booleans are
rejected with status `400`.

Successful requests store the event batch and client metadata in PostgreSQL and
return the created row:

```json
{
  "status": 201,
  "message": "Logs added successfully",
  "data": {
    "id": "1",
    "app": "kapturecrm-ui",
    "events": [
      { "level": "info", "message": "Page loaded" },
      { "level": "error", "message": "Request failed", "status": 500 }
    ],
    "clientDetails": {
      "cmId": "CM-123",
      "browser": "Chrome",
      "os": "macOS",
      "version": "140.0"
    },
    "created_at": "2026-08-24T00:00:00.000Z"
  }
}
```

The submitted data is also printed to the server console. The application does
not impose a request-body or array-length limit.

## Filter events

Send every app-specific lookup to `POST /api/logs/filter` as JSON. The `app`
property is mandatory. The `type`, `cmId`, and date range are optional:

```json
{
  "app": "kapturecrm-ui",
  "type": "console",
  "cmId": "CM-123",
  "startDate": "2026-08-25T09:00:00.000Z",
  "endDate": "2026-08-25T10:00:00.000Z"
}
```

For an app-only lookup, send only the mandatory property:

```json
{
  "app": "kapturecrm-ui"
}
```

With Moment.js, explicitly convert the selected dates to ISO strings before
sending them:

```js
const filterPayload = {
  app: "kapturecrm-ui",
  type: "console",
  cmId: "CM-123",
  startDate: moment(selectedStartDate).toISOString(),
  endDate: moment(selectedEndDate).toISOString(),
};

const response = await fetch("http://localhost:3001/api/logs/filter", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(filterPayload),
});
```

When both optional filters are supplied, they are combined with `AND`: the
event must have the requested `type`, and its containing log batch must have the
requested top-level `clientDetails.cmId`.

`startDate` and `endDate` must either both be omitted or both be supplied. They
must be ISO 8601 date-times with a timezone, such as
`2026-08-25T09:00:00.000Z`. Moment's `toISOString()` produces the recommended
format directly. Offset-based ISO values such as
`2026-08-25T14:30:00+05:30` are also accepted. The range is inclusive and
compares against each event's `timestamp`, not the database row's `created_at`.
Events with a missing or invalid timestamp are excluded when a date range is
active.

Every filter combination returns the same event structure:

```json
{
  "status": 200,
  "message": "Events fetched successfully",
  "data": [
    {
      "type": "console",
      "message": "Page loaded",
      "app": "kapturecrm-ui",
      "clientDetails": {
        "cmId": "CM-123",
        "browser": "Chrome",
        "os": "macOS"
      }
    }
  ]
}
```

All supplied parameters must be valid non-empty strings. The `app`, `type`, and
`cmId` comparisons are exact and case-sensitive after surrounding whitespace is
removed. A missing or blank `app`, an incomplete date pair, an invalid date, or
a start date after the end date returns status `400`. No matching events returns
status `404` with an empty `data` array.

The previous `/api/logs/filter-by-cm-id` and `/api/logs/:app` routes have been
removed. Use `POST /api/logs/filter` for those lookups.
