import { addEvent } from "./EventQueue";

const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  "[data-monitoring-name]",
  "[aria-label]",
].join(",");
const IGNORED_SELECTOR = "[data-monitoring-ignore],[data-kapture-recorder]";
let isStarted = false;

function normalizeLabel(value) {
  const label = typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";

  return label ? label.slice(0, 100) : undefined;
}

export function startClickTracker() {
  if (isStarted) {
    return;
  }

  isStarted = true;
  document.addEventListener("click", (event) => {
    const path = typeof event.composedPath === "function"
      ? event.composedPath()
      : [event.target];

    if (path.some((node) => node?.closest?.(IGNORED_SELECTOR))) {
      return;
    }

    const target = path.find((node) => node?.matches?.(INTERACTIVE_SELECTOR))
      || event.target?.closest?.(INTERACTIVE_SELECTOR);

    if (!target) {
      return;
    }

    const element = target.tagName.toLowerCase();
    const associatedLabel = Array.from(target.labels || [])
      .map((label) => normalizeLabel(label.innerText))
      .find(Boolean);
    const monitoringName = normalizeLabel(target.getAttribute("data-monitoring-name"));
    const controlName = normalizeLabel(target.getAttribute("name"));
    const label = normalizeLabel(target.innerText)
      || monitoringName
      || normalizeLabel(target.getAttribute("aria-label"))
      || associatedLabel
      || controlName
      || normalizeLabel(target.getAttribute("id"));
    const explicitRole = normalizeLabel(target.getAttribute("role"));
    const role = explicitRole
      || (element === "button" || element === "summary" ? "button" : undefined)
      || (element === "a" ? "link" : undefined);
    const inputType = element === "input"
      ? String(target.type || target.getAttribute("type") || "text").toLowerCase()
      : "";
    const buttonType = element === "button"
      ? String(target.type || target.getAttribute("type") || "submit").toLowerCase()
      : "";
    const selectType = element === "select"
      ? String(target.type || (target.multiple ? "select-multiple" : "select-one")).toLowerCase()
      : "";
    const controlType = inputType
      || selectType
      || explicitRole
      || (element === "a" ? "link" : undefined)
      || (element === "summary" ? "disclosure" : undefined)
      || element;
    const isCheckable = inputType === "checkbox" || inputType === "radio";

    addEvent({
      id: crypto.randomUUID(),
      type: "user-click",
      element,
      controlType,
      ...(label && { label }),
      ...(role && { role }),
      ...(monitoringName && { monitoringName }),
      ...(controlName && { controlName }),
      ...(inputType && { inputType }),
      ...(buttonType && { buttonType }),
      ...(selectType && { selectType }),
      ...(isCheckable && { checked: Boolean(target.checked) }),
      timestamp: new Date().toISOString(),
    });
  }, true);
}
