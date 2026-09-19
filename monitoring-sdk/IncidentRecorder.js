import { clearActiveIncident, setActiveIncident } from "./EventQueue";
import { getPageViewId, getSessionId, getTabId } from "./Identity";

const CHUNK_INTERVAL = 5000;
const MAX_DURATION = 300000;

export function initializeIncidentRecorder({
  app,
  endpoint,
  flushLogs,
  getClientDetails,
  recorderScriptUrl,
}) {
  if (!app || !endpoint || !recorderScriptUrl) {
    return;
  }

  if (!document.body) {
    window.addEventListener("DOMContentLoaded", () => initializeIncidentRecorder({
      app, endpoint, flushLogs, getClientDetails, recorderScriptUrl,
    }), { once: true });
    return;
  }

  const host = document.createElement("div");
  host.dataset.kaptureRecorder = "true";
  const root = host.attachShadow({ mode: "closed" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        width: 300px; box-sizing: border-box; padding: 12px;
        border-radius: 12px; background: #111827; color: #f9fafb;
        box-shadow: 0 10px 30px rgba(0,0,0,.3);
        font: 14px/1.4 system-ui, sans-serif;
      }
      button, input, textarea { box-sizing: border-box; font: inherit; }
      button { cursor: pointer; border: 0; border-radius: 8px; padding: 9px 12px; }
      .primary { width: 100%; background: #dc2626; color: white; font-weight: 700; }
      .secondary { background: #374151; color: white; }
      .danger { background: transparent; color: #fca5a5; }
      .row { display: flex; gap: 8px; margin-top: 10px; }
      .row button { flex: 1; }
      .status { margin-top: 8px; color: #d1d5db; font-size: 12px; }
      form { display: none; }
      label { display: block; margin-top: 9px; font-size: 12px; }
      input, textarea {
        width: 100%; margin-top: 4px; padding: 8px; border: 1px solid #4b5563;
        border-radius: 6px; background: #1f2937; color: white;
      }
      textarea { min-height: 58px; resize: vertical; }
      .error { color: #fca5a5; }
    </style>
    <div class="panel">
      <button class="primary" id="record" type="button">● Record incident</button>
      <div class="status" id="status"></div>
      <form id="details">
        <label>Title *<input id="title" maxlength="160" required /></label>
        <label>Expected behavior<textarea id="expected" maxlength="2000"></textarea></label>
        <label>Actual behavior / notes<textarea id="actual" maxlength="2000"></textarea></label>
        <div class="row">
          <button class="danger" id="discard" type="button">Discard</button>
          <button class="secondary" id="submit" type="submit">Submit</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(host);

  const recordButton = root.getElementById("record");
  const status = root.getElementById("status");
  const form = root.getElementById("details");
  let incidentId;
  let startedAtMs;
  let endedAtMs;
  let sequence = 0;
  let events = [];
  let stopRecording;
  let chunkTimer;
  let durationTimer;
  let clockTimer;
  let uploading = false;
  let currentUpload;

  async function flushReplayEvents() {
    if (uploading) {
      const uploadSucceeded = await currentUpload;

      if (!uploadSucceeded) {
        return false;
      }
    }

    if (!incidentId || events.length === 0) {
      return events.length === 0;
    }

    uploading = true;
    const batch = events.splice(0, events.length);
    currentUpload = (async () => {
      try {
        const response = await fetch(`${endpoint}/${incidentId}/chunks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequence, events: batch }),
        });

        if (!response.ok) {
          throw new Error(`Replay upload returned ${response.status}`);
        }

        sequence += 1;
        return true;
      } catch (error) {
        events.unshift(...batch);
        status.textContent = "Replay upload failed. It will retry automatically.";
        status.classList.add("error");
        return false;
      } finally {
        uploading = false;
      }
    })();

    return currentUpload;
  }

  function stop() {
    if (!stopRecording) {
      return;
    }

    stopRecording();
    stopRecording = undefined;
    clearInterval(chunkTimer);
    clearInterval(clockTimer);
    clearTimeout(durationTimer);
    clearActiveIncident();
    endedAtMs = Date.now();
    recordButton.style.display = "none";
    form.style.display = "block";
    status.textContent = "Recording stopped. Add a title and submit the incident.";
    status.classList.remove("error");
    flushReplayEvents();
  }

  recordButton.addEventListener("click", async () => {
    if (stopRecording) {
      stop();
      return;
    }

    if (!window.confirm(
      "Start incident recording? All visible text and entered values, including passwords, will be captured. Use synthetic QA data only.",
    )) {
      return;
    }

    recordButton.disabled = true;
    status.textContent = "Preparing recorder…";

    try {
      if (!window.__KaptureIncidentRecorder) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = recorderScriptUrl;
          script.onload = resolve;
          script.onerror = () => reject(new Error("Recorder bundle failed to load"));
          document.head.appendChild(script);
        });
      }

      startedAtMs = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app,
          startedAt: new Date(startedAtMs).toISOString(),
          sessionId: getSessionId(),
          tabId: getTabId(),
          pageViewId: getPageViewId(),
          clientDetails: getClientDetails(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Incident endpoint returned ${response.status}`);
      }

      incidentId = (await response.json()).data.id;
      sequence = 0;
      events = [];
      setActiveIncident({ incidentId, startedAtMs });
      stopRecording = window.__KaptureIncidentRecorder.record({
        emit(event) {
          events.push(event);
        },
        blockSelector: "[data-kapture-recorder]",
        maskAllInputs: false,
        maskInputOptions: {
          color: false, date: false, "datetime-local": false, email: false,
          month: false, number: false, range: false, search: false,
          tel: false, text: false, time: false, url: false, week: false,
          textarea: false, select: false, password: false,
        },
      });
      chunkTimer = setInterval(flushReplayEvents, CHUNK_INTERVAL);
      durationTimer = setTimeout(stop, MAX_DURATION);
      clockTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtMs) / 1000);
        status.textContent = `Recording ${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")} / 05:00`;
      }, 1000);
      recordButton.textContent = "■ Stop recording";
      recordButton.disabled = false;
      status.textContent = "Recording 00:00 / 05:00";
    } catch (error) {
      recordButton.disabled = false;
      status.textContent = "Could not start incident recording. Try again.";
      status.classList.add("error");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = root.getElementById("title").value.trim();

    if (!title) {
      status.textContent = "Enter an incident title.";
      status.classList.add("error");
      return;
    }

    root.getElementById("submit").disabled = true;
    status.textContent = "Submitting incident…";
    status.classList.remove("error");

    const replayUploaded = await flushReplayEvents();
    const logsUploaded = await flushLogs();

    if (!replayUploaded || !logsUploaded) {
      root.getElementById("submit").disabled = false;
      status.textContent = "Upload failed. Click Submit to retry.";
      status.classList.add("error");
      return;
    }

    const response = await fetch(`${endpoint}/${incidentId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        expectedBehavior: root.getElementById("expected").value,
        actualBehavior: root.getElementById("actual").value,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: Math.min(endedAtMs - startedAtMs, MAX_DURATION),
      }),
    });

    if (!response.ok) {
      root.getElementById("submit").disabled = false;
      status.textContent = "Submission failed. Click Submit to retry.";
      status.classList.add("error");
      return;
    }

    form.style.display = "none";
    status.textContent = `Incident ${incidentId} submitted.`;
    incidentId = undefined;
    recordButton.textContent = "● Record incident";
    recordButton.style.display = "block";
    root.getElementById("title").value = "";
    root.getElementById("expected").value = "";
    root.getElementById("actual").value = "";
    root.getElementById("submit").disabled = false;
  });

  root.getElementById("discard").addEventListener("click", async () => {
    if (incidentId) {
      await fetch(`${endpoint}/${incidentId}`, { method: "DELETE" });
    }

    form.style.display = "none";
    status.textContent = "Incident discarded.";
    incidentId = undefined;
    events = [];
    recordButton.textContent = "● Record incident";
    recordButton.style.display = "block";
  });
}
