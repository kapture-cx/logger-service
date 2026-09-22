const MAX_VISIBLE_INSTRUCTIONS = 5;
const MAX_INSTRUCTION_LENGTH = 500;

let container;
let domReadyListenerAttached = false;
let pendingInstructions = [];

function formatTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createContainer() {
  if (container || !document.body) {
    return container;
  }

  const host = document.createElement("div");
  host.dataset.kaptureInstructions = "true";
  const root = host.attachShadow({ mode: "closed" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      #notifications {
        position: fixed; top: 20px; right: 20px; z-index: 2147483647;
        display: flex; width: min(360px, calc(100vw - 40px));
        flex-direction: column; gap: 10px;
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .notification {
        box-sizing: border-box; border: 1px solid #bfdbfe; border-radius: 12px;
        background: #ffffff; color: #0f172a; padding: 14px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, .22);
      }
      .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .title { margin: 0; color: #1d4ed8; font-size: 13px; font-weight: 700; }
      .close {
        width: 28px; height: 28px; flex: 0 0 auto; margin: -6px -6px 0 0;
        border: 0; border-radius: 7px; background: transparent; color: #64748b;
        cursor: pointer; font: 20px/1 system-ui, sans-serif;
      }
      .close:hover, .close:focus-visible { background: #eff6ff; color: #1d4ed8; outline: none; }
      .message { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #1e293b; }
      .time { display: block; margin-top: 8px; color: #64748b; font-size: 11px; }
    </style>
    <div id="notifications" role="region" aria-label="Live support messages"></div>`;

  document.body.appendChild(host);
  container = root.getElementById("notifications");
  return container;
}

function renderInstruction(instruction) {
  const notificationContainer = createContainer();

  if (!notificationContainer) {
    return false;
  }

  const notification = document.createElement("section");
  notification.className = "notification";

  const header = document.createElement("div");
  header.className = "header";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = "Live support message";

  const closeButton = document.createElement("button");
  closeButton.className = "close";
  closeButton.type = "button";
  closeButton.ariaLabel = "Dismiss live support message";
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => notification.remove());

  const message = document.createElement("p");
  message.className = "message";
  message.textContent = instruction.text;

  const time = document.createElement("time");
  time.className = "time";
  time.dateTime = instruction.sentAt;
  time.textContent = formatTime(instruction.sentAt);

  header.appendChild(title);
  header.appendChild(closeButton);
  notification.appendChild(header);
  notification.appendChild(message);

  if (time.textContent) {
    notification.appendChild(time);
  }

  notificationContainer.appendChild(notification);

  while (notificationContainer.children.length > MAX_VISIBLE_INSTRUCTIONS) {
    notificationContainer.firstElementChild.remove();
  }

  return true;
}

function renderPendingInstructions() {
  domReadyListenerAttached = false;
  const instructions = pendingInstructions;
  pendingInstructions = [];

  for (const instruction of instructions) {
    if (!renderInstruction(instruction)) {
      pendingInstructions.push(instruction);
    }
  }
}

export function showAgentInstruction(instruction) {
  const text =
    typeof instruction?.text === "string" ? instruction.text.trim() : "";

  if (!text || text.length > MAX_INSTRUCTION_LENGTH) {
    return false;
  }

  const normalizedInstruction = {
    text,
    sentAt:
      typeof instruction.sentAt === "string" ? instruction.sentAt : "",
  };

  if (renderInstruction(normalizedInstruction)) {
    return true;
  }

  pendingInstructions.push(normalizedInstruction);

  if (!domReadyListenerAttached) {
    domReadyListenerAttached = true;
    window.addEventListener("DOMContentLoaded", renderPendingInstructions, {
      once: true,
    });
  }

  return true;
}
